"""Real Telegram Business integration for Мастерская -- replaces the
scripted TelegramPreviewModal fake demo. One pilot manager's personal
Telegram account for now (see the design spec); the schema supports more
connections later without changes here.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi import Depends
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user
from app.telegram.bot_client import TelegramSendError, send_message, verify_webhook_signature
from app.telegram.matching import find_client_by_phone
from app.ai.telegram_evaluator import evaluate_conversation

router = APIRouter()
api_router = APIRouter(prefix="/api/telegram-business")


def _get_connection(client, business_connection_id: str) -> dict | None:
    res = (
        client.table("telegram_business_connections").select("*")
        .eq("business_connection_id", business_connection_id).execute().data
    )
    return res[0] if res else None


def _get_or_create_conversation(client, connection: dict, chat: dict) -> dict:
    existing = (
        client.table("telegram_conversations").select("*")
        .eq("connection_id", connection["id"]).eq("telegram_chat_id", chat["id"])
        .execute().data
    )
    if existing:
        return existing[0]
    inserted = client.table("telegram_conversations").insert({
        "tenant_id": connection["tenant_id"],
        "connection_id": connection["id"],
        "telegram_chat_id": chat["id"],
        "telegram_first_name": chat.get("first_name"),
        "telegram_username": chat.get("username"),
    }).execute().data[0]
    return inserted


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
        client.table("telegram_business_connections").update({
            "is_enabled": connection_event.get("is_enabled", False),
            "disconnected_at": None if connection_event.get("is_enabled") else datetime.now(timezone.utc).isoformat(),
        }).eq("business_connection_id", connection_event["id"]).execute()
        return {"ok": True}

    message = update.get("business_message") or update.get("edited_business_message")
    if not message or "text" not in message:
        return {"ok": True}  # non-text or unrecognized update -- nothing to relay/evaluate

    connection = _get_connection(client, message["business_connection_id"])
    if not connection:
        return {"ok": True}  # message from a connection we don't have a row for -- ignore, don't crash

    conversation = _get_or_create_conversation(client, connection, message["chat"])

    if conversation.get("client_id") is None and message.get("contact"):
        client_id = find_client_by_phone(client, connection["tenant_id"], message["contact"]["phone_number"])
        if client_id:
            client.table("telegram_conversations").update({"client_id": client_id}).eq("id", conversation["id"]).execute()
            conversation["client_id"] = client_id

    client.table("telegram_messages").insert({
        "conversation_id": conversation["id"], "direction": "inbound",
        "content": message["text"], "telegram_message_id": message["message_id"],
    }).execute()
    client.table("telegram_conversations").update({
        "last_message_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation["id"]).execute()

    try:
        history = _history_for_evaluation(client, conversation["id"])
        evaluation = evaluate_conversation(history)
        client.table("telegram_conversations").update({
            "summary": evaluation["summary"], "next_step_suggestion": evaluation["next_step"],
            "draft_reply": evaluation["draft_reply"], "draft_generated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", conversation["id"]).execute()
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
        "draft_reply": None, "last_message_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation_id).execute()
    return {"ok": True}


class LinkBody(BaseModel):
    client_id: str | None = None
    new_client_name: str | None = None
    new_client_phone: str | None = None


@api_router.patch("/conversations/{conversation_id}/link")
def link_conversation(conversation_id: str, body: LinkBody, user=Depends(get_current_user)):
    client = get_service_client()
    if body.client_id:
        client_id = body.client_id
    elif body.new_client_phone:
        from app.services.client_service import get_or_create_client
        client_id = get_or_create_client(client, user.tenant_id, body.new_client_phone, body.new_client_name)
    else:
        raise HTTPException(status_code=400, detail="client_id or new_client_phone required")

    updated = (
        client.table("telegram_conversations").update({"client_id": client_id})
        .eq("id", conversation_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Conversation not found")
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
