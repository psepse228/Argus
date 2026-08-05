"""Calendar section (Day 4) -- event feed fed by confirmed AI-monitor
proposals (see app/ai/telegram_evaluator.py + the Telegram webhook) and
manual entries. Proposals sit at status='proposed' until a manager reviews
and confirms or dismisses them -- same review-after posture as
spravka_requests, never silently auto-confirmed.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user
from app.services.ai_events import mark_event_outcome

router = APIRouter(prefix="/api/calendar")


class CalendarEventCreate(BaseModel):
    title: str
    event_at: datetime
    note: str | None = None
    client_id: str | None = None


class CalendarEventUpdate(BaseModel):
    title: str | None = None
    event_at: datetime | None = None
    note: str | None = None


@router.get("")
def list_events(user=Depends(get_current_user)):
    client = get_service_client()
    return (
        client.table("calendar_events").select("*, clients(name, phone)")
        .eq("tenant_id", user.tenant_id).neq("status", "dismissed")
        .order("event_at").execute().data
    )


@router.post("")
def create_event(body: CalendarEventCreate, user=Depends(get_current_user)):
    client = get_service_client()
    if body.client_id:
        owned = (
            client.table("clients").select("id")
            .eq("id", body.client_id).eq("tenant_id", user.tenant_id).execute().data
        )
        if not owned:
            raise HTTPException(status_code=404, detail="Client not found")
    inserted = client.table("calendar_events").insert({
        "tenant_id": user.tenant_id,
        "client_id": body.client_id,
        "title": body.title,
        "event_at": body.event_at.isoformat(),
        "note": body.note,
        "source": "manual", "status": "confirmed", "created_by": user.email,
    }).execute().data
    return inserted[0]


@router.patch("/{event_id}")
def update_event(event_id: str, body: CalendarEventUpdate, user=Depends(get_current_user)):
    """Lets a manager correct the AI monitor's guess (e.g. wrong time) before
    confirming it, or edit a manual entry afterward."""
    updates = {k: v for k, v in body.model_dump(mode="json").items() if k in body.model_fields_set}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    client = get_service_client()
    updated = (
        client.table("calendar_events").update(updates)
        .eq("id", event_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Event not found")
    return updated[0]


@router.post("/{event_id}/confirm")
def confirm_event(event_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    updated = (
        client.table("calendar_events")
        .update({"status": "confirmed", "created_by": user.email, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", event_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Event not found")
    try:
        mark_event_outcome(client, user.tenant_id, event_id, "confirmed")
    except Exception:
        pass  # best-effort -- the event is already confirmed regardless of the journal update
    return updated[0]


@router.post("/{event_id}/dismiss")
def dismiss_event(event_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    updated = (
        client.table("calendar_events")
        .update({"status": "dismissed", "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", event_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Event not found")
    try:
        mark_event_outcome(client, user.tenant_id, event_id, "dismissed")
    except Exception:
        pass  # best-effort -- the event is already dismissed regardless of the journal update
    return updated[0]
