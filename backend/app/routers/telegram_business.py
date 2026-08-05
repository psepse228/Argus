"""Real Telegram Business integration for Мастерская -- replaces the
scripted TelegramPreviewModal fake demo. One pilot manager's personal
Telegram account for now (see the design spec); the schema supports more
connections later without changes here.
"""
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi import Depends
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user
from app.telegram.bot_client import TelegramSendError, send_message, verify_webhook_signature
from app.telegram.matching import find_client_by_phone
from app.ai.telegram_evaluator import evaluate_conversation
from app.ai.functions import get_units, get_payment_plan_rates
from app.services.ai_events import log_ai_event

router = APIRouter()
api_router = APIRouter(prefix="/api/telegram-business")


def _get_connection(client, business_connection_id: str) -> dict | None:
    res = (
        client.table("telegram_business_connections").select("*")
        .eq("business_connection_id", business_connection_id).execute().data
    )
    return res[0] if res else None


def _get_or_create_conversation(client, connection: dict, chat: dict) -> tuple[dict, bool]:
    """Returns (conversation, is_new) -- is_new is what the auto-greeting
    (Мастерская flow (a)) keys off: a brand-new conversation IS a lead just
    arriving, in this codebase's actual shape (see the week plan's Day 3
    note -- there's no separate lead-creation endpoint this pilot uses;
    Telegram is the real arrival channel)."""
    existing = (
        client.table("telegram_conversations").select("*")
        .eq("connection_id", connection["id"]).eq("telegram_chat_id", chat["id"])
        .execute().data
    )
    if existing:
        return existing[0], False
    inserted = client.table("telegram_conversations").insert({
        "tenant_id": connection["tenant_id"],
        "connection_id": connection["id"],
        "telegram_chat_id": chat["id"],
        "telegram_first_name": chat.get("first_name"),
        "telegram_username": chat.get("username"),
    }).execute().data[0]
    return inserted, True


# Мастерская flow (a): the fast, fixed first-touch message -- deliberately
# NOT AI-composed (that's flow (b)'s job, Day 5). Fires once, automatically,
# the moment a brand-new conversation's first real text message arrives; no
# propose-then-confirm step, because there's no parsing/inference here that
# could misfire -- same reasoning the client used to describe this as the
# "small, self-contained half of the split".
_AUTO_GREETING_TEXT = (
    "Здравствуйте! Спасибо, что написали 👋\n"
    "Мы получили ваше сообщение — менеджер ответит вам в ближайшее время. "
    "Если хотите, можете уже сейчас написать, что вас интересует."
)


def _send_auto_greeting(client, connection: dict, conversation: dict) -> None:
    send_message(connection["business_connection_id"], conversation["telegram_chat_id"], _AUTO_GREETING_TEXT)
    client.table("telegram_messages").insert({
        "conversation_id": conversation["id"], "direction": "outbound",
        "content": _AUTO_GREETING_TEXT, "sent_by": None,
    }).execute()
    client.table("telegram_conversations").update({
        "last_message_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation["id"]).execute()


def _history_for_evaluation(client, conversation_id: str) -> list[dict]:
    rows = (
        client.table("telegram_messages").select("direction, content")
        .eq("conversation_id", conversation_id).order("created_at").execute().data
    )
    return [{"role": "client" if r["direction"] == "inbound" else "manager", "content": r["content"]} for r in rows]


@router.post("/webhook/telegram-business")
def telegram_business_webhook(update: dict, request: Request):
    # Plain `def`, not `async def` -- this handler makes several blocking
    # Supabase calls below, so it must stay on FastAPI's threadpool path
    # (see concepts/fastapi-async-blocking-io in the wiki). Taking `update:
    # dict` as a body parameter (instead of manually `await request.json()`)
    # is what makes that possible: FastAPI parses the JSON body for us
    # synchronously, and `request` is only used here for its headers, which
    # don't require awaiting either.
    secret = request.headers.get("x-telegram-bot-api-secret-token")
    if not verify_webhook_signature(secret):
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    client = get_service_client()

    connection_event = update.get("business_connection")
    if connection_event:
        is_enabled = connection_event.get("is_enabled", False)
        connection_id = connection_event["id"]
        if _get_connection(client, connection_id):
            client.table("telegram_business_connections").update({
                "is_enabled": is_enabled,
                "disconnected_at": None if is_enabled else datetime.now(timezone.utc).isoformat(),
            }).eq("business_connection_id", connection_id).execute()
        else:
            # First time this business_connection_id has ever been seen --
            # bootstrap the row instead of requiring an operator to hand-
            # capture the id from logs and INSERT it manually before any
            # message can be relayed. Single-tenant, single-manager pilot,
            # so tenant/manager come from env rather than the (tenant-less)
            # Telegram payload -- see telegram_business_connections' comment
            # on why business_connection_id must stay globally unique.
            client.table("telegram_business_connections").insert({
                "tenant_id": os.environ["TELEGRAM_PILOT_TENANT_ID"],
                "manager_email": os.environ["TELEGRAM_PILOT_MANAGER_EMAIL"],
                "business_connection_id": connection_id,
                "telegram_user_id": connection_event.get("user", {}).get("id") or connection_event["user_chat_id"],
                "is_enabled": is_enabled,
            }).execute()
        return {"ok": True}

    message = update.get("business_message") or update.get("edited_business_message")
    # A shared-contact message has NO "text" field at all (it's a distinct
    # Telegram content type) -- gating on "text" alone would silently
    # discard every contact-share and make the phone-matching feature below
    # unreachable. Accept the update if it has either.
    if not message or ("text" not in message and "contact" not in message):
        return {"ok": True}  # unrecognized update shape -- nothing to relay/evaluate

    connection = _get_connection(client, message["business_connection_id"])
    if not connection:
        return {"ok": True}  # message from a connection we don't have a row for -- ignore, don't crash

    conversation, is_new_conversation = _get_or_create_conversation(client, connection, message["chat"])

    if conversation.get("client_id") is None and message.get("contact"):
        client_id = find_client_by_phone(client, connection["tenant_id"], message["contact"]["phone_number"])
        if client_id:
            client.table("telegram_conversations").update({"client_id": client_id}).eq("id", conversation["id"]).execute()
            conversation["client_id"] = client_id

    # A contact-share carries no text to save as a message or evaluate --
    # matching (above) is the only thing it's here to do.
    if "text" in message:
        client.table("telegram_messages").insert({
            "conversation_id": conversation["id"], "direction": "inbound",
            "content": message["text"], "telegram_message_id": message["message_id"],
        }).execute()
        client.table("telegram_conversations").update({
            "last_message_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", conversation["id"]).execute()

        if is_new_conversation:
            try:
                _send_auto_greeting(client, connection, conversation)
            except Exception:
                pass  # best-effort -- a failed auto-greeting must not break message ingestion

        try:
            history = _history_for_evaluation(client, conversation["id"])
            # Мастерская flow (b): ground the draft reply in real inventory/
            # pricing (plain reads, reusing the same functions the assistant
            # chat calls) instead of a second OpenAI round-trip. Best-effort
            # -- if this lookup fails, fall through with no inventory context
            # rather than lose the whole evaluation.
            inventory_context = None
            try:
                inventory_context = {
                    "units": get_units(connection["tenant_id"]),
                    "rates": get_payment_plan_rates(connection["tenant_id"]),
                }
            except Exception:
                pass
            evaluation = evaluate_conversation(history, inventory_context)
            client.table("telegram_conversations").update({
                "summary": evaluation["summary"], "next_step_suggestion": evaluation["next_step"],
                "draft_reply": evaluation["draft_reply"], "coaching_tip": evaluation["coaching_tip"],
                "draft_generated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", conversation["id"]).execute()

            if evaluation.get("coaching_tip"):
                try:
                    log_ai_event(
                        client, connection["tenant_id"], "coaching_tip", evaluation["coaching_tip"],
                        client_id=conversation.get("client_id"), manager_email=connection["manager_email"],
                    )
                except Exception:
                    pass  # best-effort -- a failed journal write must not break message evaluation

            # AI "monitor" (Day 4): propose, never auto-confirm -- same
            # review-after posture as spravka_requests. One pending proposal
            # per conversation at a time (skip re-proposing every message
            # while one's still awaiting a manager's review).
            if evaluation.get("has_event") and evaluation.get("event_at"):
                try:
                    event_at = datetime.fromisoformat(evaluation["event_at"].replace("Z", "+00:00"))
                    existing_proposal = (
                        client.table("calendar_events").select("id")
                        .eq("telegram_conversation_id", conversation["id"]).eq("status", "proposed")
                        .execute().data
                    )
                    if not existing_proposal:
                        inserted_event = client.table("calendar_events").insert({
                            "tenant_id": connection["tenant_id"],
                            "client_id": conversation.get("client_id"),
                            "telegram_conversation_id": conversation["id"],
                            "title": evaluation.get("event_title") or "Встреча с клиентом",
                            "event_at": event_at.isoformat(),
                            "note": evaluation.get("event_note"),
                            "source": "monitor", "status": "proposed",
                        }).execute().data[0]
                        try:
                            log_ai_event(
                                client, connection["tenant_id"], "event_proposed",
                                f"Предложено событие: {inserted_event['title']}",
                                client_id=conversation.get("client_id"), manager_email=connection["manager_email"],
                                related_id=inserted_event["id"],
                            )
                        except Exception:
                            pass  # best-effort -- a failed journal write must not break the proposal itself
                except (ValueError, KeyError):
                    pass  # unparseable event_at -- skip the proposal rather than guess
        except Exception:
            pass  # best-effort -- the message still saved; a manager can always reply manually

    return {"ok": True}


class SendBody(BaseModel):
    text: str


@api_router.post("/conversations/{conversation_id}/send")
def send_reply(conversation_id: str, body: SendBody, user=Depends(get_current_user)):
    client = get_service_client()
    conv = (
        client.table("telegram_conversations").select("*, telegram_business_connections(business_connection_id)")
        .eq("id", conversation_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation = conv[0]
    business_connection_id = conversation["telegram_business_connections"]["business_connection_id"]

    try:
        send_message(business_connection_id, conversation["telegram_chat_id"], body.text)
    except TelegramSendError:
        raise HTTPException(status_code=503, detail="Не удалось отправить сообщение в Telegram — попробуйте ещё раз")
    client.table("telegram_messages").insert({
        "conversation_id": conversation_id, "direction": "outbound",
        "content": body.text, "sent_by": user.email,
    }).execute()
    client.table("telegram_conversations").update({
        "draft_reply": None, "coaching_tip": None, "last_message_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation_id).execute()
    return {"ok": True}


class LinkBody(BaseModel):
    client_id: str | None = None
    new_client_name: str | None = None
    new_client_phone: str | None = None


@api_router.patch("/conversations/{conversation_id}/link")
def link_conversation(conversation_id: str, body: LinkBody, user=Depends(get_current_user)):
    client = get_service_client()

    # Check the conversation itself belongs to this tenant BEFORE touching
    # anything else -- both so a bad conversation_id 404s cleanly, and so a
    # get_or_create_client call below never runs (and inserts a client row)
    # for a request that was going to fail anyway.
    conv = (
        client.table("telegram_conversations").select("id")
        .eq("id", conversation_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if body.client_id:
        # This app has no RLS (service-role client bypasses it entirely) --
        # this tenant check is the ONLY thing standing between a request and
        # linking a conversation to a client that belongs to a different
        # tenant, so it's not optional. Every other place a client_id FK
        # gets set in this codebase derives it internally (get_or_create_client)
        # rather than trusting a raw id from the request body; this is the
        # first endpoint that accepts one directly, so it needs its own check.
        owned = (
            client.table("clients").select("id")
            .eq("id", body.client_id).eq("tenant_id", user.tenant_id).execute().data
        )
        if not owned:
            raise HTTPException(status_code=404, detail="Client not found")
        client_id = body.client_id
    elif body.new_client_phone:
        from app.services.client_service import get_or_create_client
        from app.telegram.matching import normalize_phone
        # Normalized the same way the webhook's own auto-match does --
        # otherwise a manager typing the number in a different format than
        # however Telegram delivered it creates a second, duplicate client
        # instead of matching the one the webhook may have already made.
        normalized_phone = normalize_phone(body.new_client_phone)
        digits = normalized_phone.lstrip("+")
        if not (9 <= len(digits) <= 15):
            raise HTTPException(status_code=400, detail="Некорректный номер телефона")
        # get_or_create_client silently returns the EXISTING client on a
        # phone collision (and only backfills the name if that row had none)
        # -- fine for the webhook's own best-effort auto-match, but this is
        # an explicit "create a new client" action from a person, so a
        # collision needs to surface rather than silently attach this
        # conversation to a stranger's existing card with a 200 OK.
        existing = (
            client.table("clients").select("id, name")
            .eq("tenant_id", user.tenant_id).eq("phone", normalized_phone).execute().data
        )
        if existing:
            existing_label = existing[0]["name"] or normalized_phone
            raise HTTPException(
                status_code=409,
                detail=f"Клиент с номером {normalized_phone} уже существует ({existing_label}) — привяжите к нему вместо создания нового",
            )
        client_id = get_or_create_client(client, user.tenant_id, normalized_phone, body.new_client_name)
    else:
        raise HTTPException(status_code=400, detail="client_id or new_client_phone required")

    updated = (
        client.table("telegram_conversations").update({"client_id": client_id})
        .eq("id", conversation_id).eq("tenant_id", user.tenant_id).execute().data
    )
    return updated[0]


@api_router.get("/conversations/unmatched")
def list_unmatched(user=Depends(get_current_user)):
    client = get_service_client()
    return (
        client.table("telegram_conversations").select("*")
        .eq("tenant_id", user.tenant_id).is_("client_id", "null")
        .order("last_message_at", desc=True).execute().data
    )


@api_router.get("/conversations/recent-matched")
def list_recent_matched(user=Depends(get_current_user)):
    """Matched conversations too, not just unmatched ones -- a client who
    already has a client_id but isn't pinned into "В работе" would
    otherwise have no way to surface a new message at all. Same discovery
    idea as unpinnedApprovals for справки, just for Telegram activity."""
    client = get_service_client()
    return (
        client.table("telegram_conversations").select("*, clients(name, phone)")
        .eq("tenant_id", user.tenant_id).not_.is_("client_id", "null")
        .order("last_message_at", desc=True).limit(20).execute().data
    )


@api_router.get("/conversations/by-client/{client_id}")
def get_by_client(client_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    conv = (
        client.table("telegram_conversations").select("*")
        .eq("tenant_id", user.tenant_id).eq("client_id", client_id).execute().data
    )
    if not conv:
        return {"conversation": None, "messages": []}
    conversation = conv[0]
    messages = (
        client.table("telegram_messages").select("*")
        .eq("conversation_id", conversation["id"]).order("created_at").execute().data
    )
    return {"conversation": conversation, "messages": messages}
