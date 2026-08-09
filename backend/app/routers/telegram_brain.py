"""Proactive Argus Brain over Telegram (2026-08-08) -- reuses the existing
@Argus_solurabot (TELEGRAM_BOT_TOKEN), but talks directly to a manager/boss
in their own personal chat with the bot, completely separate from the
business-connection client-relay path in telegram_business.py. Three
endpoints: generate a one-time link code + deep link, check whether the
current user is linked, and send today's brief on demand -- the same
first-person voice already used inside the app (see app/ai/brain_greeting.py),
just delivered somewhere a manager doesn't have to open Argus to see.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request

from app.ai.brain_greeting import generate_greeting
from app.db import get_service_client
from app.deps import get_current_user
from app.rate_limit import limiter
from app.routers.brain_items import _sync_and_list
from app.telegram.bot_client import TelegramSendError, send_bot_message

router = APIRouter(prefix="/api/telegram-brain")

BOT_USERNAME = "Argus_solurabot"


def _get_tenant_user(client, tenant_id: str, email: str) -> dict:
    rows = (
        client.table("tenant_users").select("*")
        .eq("tenant_id", tenant_id).eq("email", email)
        .execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return rows[0]


@router.get("/status")
def get_status(user=Depends(get_current_user)):
    client = get_service_client()
    row = _get_tenant_user(client, user.tenant_id, user.email)
    return {"connected": row.get("telegram_chat_id") is not None}


@router.post("/link-code")
def create_link_code(user=Depends(get_current_user)):
    """A fresh code every time this is called -- overwrites any unused
    previous one, since only the most recently generated deep link is ever
    the one a user actually clicked."""
    client = get_service_client()
    row = _get_tenant_user(client, user.tenant_id, user.email)
    code = secrets.token_hex(4)
    client.table("tenant_users").update({"telegram_link_code": code}).eq("id", row["id"]).execute()
    return {"code": code, "deep_link": f"https://t.me/{BOT_USERNAME}?start={code}"}


@router.post("/send-now")
@limiter.limit("10/minute")
def send_now(request: Request, user=Depends(get_current_user)):
    """On-demand send -- the reliable path a manager/boss can trigger
    themselves right now, rather than waiting on a schedule. Reuses the
    exact same role-scoped brain_items sync and greeting voice the in-app
    surfaces already use, so the Telegram message is never a second,
    differently-computed opinion."""
    client = get_service_client()
    row = _get_tenant_user(client, user.tenant_id, user.email)
    chat_id = row.get("telegram_chat_id")
    if not chat_id:
        raise HTTPException(status_code=400, detail="Telegram ещё не подключён")
    items = _sync_and_list(client, user.tenant_id, user.role, user.email)
    text = generate_greeting(items)
    try:
        send_bot_message(chat_id, text)
    except TelegramSendError:
        raise HTTPException(status_code=503, detail="Не удалось отправить сообщение в Telegram — попробуйте ещё раз")
    return {"ok": True, "text": text}
