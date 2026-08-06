"""Argus Brain unified queue -- the live, actionable half of Argus Brain
(ai_events.py is the passive permanent log). Role-scoped like ai_events: a
non-boss only ever syncs and sees their own open items; a boss's view syncs
every manager in the tenant and sees the union, priority-then-recency
sorted. Dismiss/confirm/snooze are all scoped the same way -- a non-boss
can only act on their own items, a boss can act on anyone's.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.ai.brain_items import sync_brain_items
from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/brain/items")


def _wake_expired_snoozes(client, tenant_id: str, assigned_to: str) -> None:
    """A snoozed item doesn't come back on its own -- there's no cron here,
    so this flips any snooze whose time has passed back to 'open' right
    before the next sync, lazily, the same pattern daily_briefing.py uses
    for cache staleness."""
    now = datetime.now(timezone.utc).isoformat()
    (
        client.table("brain_items").update({"status": "open", "snoozed_until": None})
        .eq("tenant_id", tenant_id).eq("assigned_to", assigned_to)
        .eq("status", "snoozed").lte("snoozed_until", now)
        .execute()
    )


def _sync_and_list(client, tenant_id: str, role: str, email: str) -> list[dict]:
    """The scoping+sync logic, pulled out of the route handler for direct
    test coverage -- same reasoning as ai_events.py's _query_ai_events."""
    if role != "boss":
        _wake_expired_snoozes(client, tenant_id, email)
        return sync_brain_items(client, tenant_id, email)
    managers = (
        client.table("tenant_users").select("email")
        .eq("tenant_id", tenant_id).eq("role", "sales_agent")
        .execute().data
    )
    items: list[dict] = []
    for m in managers:
        _wake_expired_snoozes(client, tenant_id, m["email"])
        items.extend(sync_brain_items(client, tenant_id, m["email"]))
    items.sort(key=lambda it: (0 if it["priority"] == "high" else 1, it["created_at"]))
    return items


@router.get("")
def list_brain_items(user=Depends(get_current_user)):
    client = get_service_client()
    return _sync_and_list(client, user.tenant_id, user.role, user.email)


def _load_item(client, item_id: str, tenant_id: str, role: str, email: str) -> dict:
    row = client.table("brain_items").select("*").eq("id", item_id).eq("tenant_id", tenant_id).execute().data
    if not row:
        raise HTTPException(status_code=404, detail="Item not found")
    item = row[0]
    if role != "boss" and item["assigned_to"] != email:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.post("/{item_id}/dismiss")
def dismiss_item(item_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    _load_item(client, item_id, user.tenant_id, user.role, user.email)
    client.table("brain_items").update({
        "status": "dismissed", "resolved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", item_id).execute()
    return {"ok": True}


@router.post("/{item_id}/confirm")
def confirm_item(item_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    _load_item(client, item_id, user.tenant_id, user.role, user.email)
    client.table("brain_items").update({
        "status": "done", "resolved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", item_id).execute()
    return {"ok": True}


class SnoozeRequest(BaseModel):
    days: int = 1


@router.post("/{item_id}/snooze")
def snooze_item(item_id: str, body: SnoozeRequest, user=Depends(get_current_user)):
    client = get_service_client()
    _load_item(client, item_id, user.tenant_id, user.role, user.email)
    until = datetime.now(timezone.utc) + timedelta(days=body.days)
    client.table("brain_items").update({
        "status": "snoozed", "snoozed_until": until.isoformat(),
    }).eq("id", item_id).execute()
    return {"ok": True}
