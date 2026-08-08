"""Thin HTTP client for the Telegram Bot API's business-connection surface --
one responsibility: talk to Telegram over HTTP, nothing about Supabase or
GPT lives here. Plain httpx, not aiogram -- a single business connection
doesn't need a multi-command dispatcher framework (see the design spec for
why Cortège's aiogram setup isn't a fit here).
"""
import hmac
import logging
import os

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org"


class TelegramSendError(Exception):
    """Raised when the Telegram Bot API call itself fails (bad HTTP status,
    timeout, connection error) -- distinct from a plain unhandled exception
    so routers can translate this into a clean HTTP error (e.g. 503) instead
    of a raw 500 with a stack trace reaching the frontend. Mirrors
    ChatUnavailableError's role in app/ai/chat.py."""


def verify_webhook_signature(received_secret: str | None) -> bool:
    """Telegram echoes back whatever secret was configured via set_webhook
    as the X-Telegram-Bot-Api-Secret-Token header on every request --
    constant-time compare (hmac.compare_digest, not `==`) against a timing
    attack, same pattern already proven in Cortège's webhook."""
    expected = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
    return bool(expected) and hmac.compare_digest(received_secret or "", expected)


def send_message(business_connection_id: str, chat_id: int, text: str) -> dict:
    """Sends as the connected business account, not as the bot itself --
    business_connection_id is what makes the client see this land in their
    chat with the manager's real Telegram account, not some generic bot."""
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    try:
        resp = httpx.post(
            f"{TELEGRAM_API_BASE}/bot{token}/sendMessage",
            json={"business_connection_id": business_connection_id, "chat_id": chat_id, "text": text},
            timeout=10.0,
        )
        resp.raise_for_status()
    except httpx.HTTPError as e:
        logger.exception("Telegram sendMessage call failed")
        raise TelegramSendError(str(e)) from e
    return resp.json()


def send_bot_message(chat_id: int, text: str) -> dict:
    """Proactive Argus Brain (2026-08-08): sends as the bot's OWN identity
    (@Argus_solurabot), not through a business connection -- this is the
    bot talking directly to a manager/boss in their personal chat with it
    (after they /start it themselves), completely unrelated to the
    business-connection client-relay path send_message() above. Same bot
    token, a different, much simpler Bot API call -- no business_connection_id."""
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    try:
        resp = httpx.post(
            f"{TELEGRAM_API_BASE}/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
            timeout=10.0,
        )
        resp.raise_for_status()
    except httpx.HTTPError as e:
        logger.exception("Telegram sendMessage (direct bot) call failed")
        raise TelegramSendError(str(e)) from e
    return resp.json()
