"""Resolves an incoming Telegram business message to an Argus client by
phone number. Telegram never exposes a phone number on a User/Chat object by
itself (business connection or not) -- only when the client explicitly
shares their contact card, which is the one moment this ever has a phone
number to work with at all.
"""

import re


def normalize_phone(raw: str) -> str:
    """Telegram's shared-contact phone_number can come through with internal
    spaces/dashes/parens (common when synced from a phone's own address
    book) even before considering the leading-'+' quirk this already
    handled -- strip everything but digits and a leading '+', or a
    perfectly real client silently fails to match on formatting alone."""
    cleaned = re.sub(r"[^\d+]", "", raw.strip())
    return cleaned if cleaned.startswith("+") else f"+{cleaned}"


def find_client_by_phone(client, tenant_id: str, phone: str) -> str | None:
    """Look-only, unlike get_or_create_client (app/services/client_service.py)
    -- an unmatched Telegram conversation should show the manual-link
    banner, not silently create a phantom client from a phone number nobody
    at Argus has confirmed belongs to them."""
    normalized = normalize_phone(phone)
    res = client.table("clients").select("id").eq("tenant_id", tenant_id).eq("phone", normalized).execute().data
    return res[0]["id"] if res else None
