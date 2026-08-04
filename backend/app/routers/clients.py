"""Client profile — before this, a "client" was just free-text (name, phone)
duplicated independently across leads and spravka_requests, with no single
place to see one person's whole history. Each client also gets their own
profile-chat conversation (see routers/conversations.py) where a rep's
entire back-and-forth about that person, plus their real Справки, live
together.
"""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.ai.brain import gather_client_context
from app.ai.client_context import summarize_client_context
from app.ai.client_segmentation import segment_clients
from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/clients")

PRIORITIES = ["hot", "warm", "cold"]


class ClientFollowupUpdate(BaseModel):
    priority: str | None = None
    next_followup_at: date | None = None
    next_followup_note: str | None = None


class AISegmentsRequest(BaseModel):
    client_ids: list[str]


def _list_clients_with_stats(client, tenant_id: str) -> list[dict]:
    """Shared by GET /api/clients and the AI-segments endpoint, so both see
    the exact same buildings/assigned_manager/last_activity_at computation."""
    clients = (
        client.table("clients").select("*").eq("tenant_id", tenant_id)
        .order("created_at", desc=True).execute().data
    )
    leads = (
        client.table("leads").select("client_id, assigned_manager, created_at, buildings(name)")
        .eq("tenant_id", tenant_id).execute().data
    )
    spravki = (
        client.table("spravka_requests")
        .select("client_id, status, created_at, units(buildings(name))")
        .eq("tenant_id", tenant_id).execute().data
    )

    lead_counts: dict[str, int] = {}
    # Per client: building names touched (leads + spravki), most-recent
    # assigned_manager (by lead created_at), and the latest of any
    # lead/spravka created_at -- "activity", not just row creation.
    buildings: dict[str, set] = {}
    manager_by_client: dict[str, tuple[str, str]] = {}  # client_id -> (created_at, manager)
    last_activity: dict[str, str] = {}

    for l in leads:
        cid = l.get("client_id")
        if not cid:
            continue
        lead_counts[cid] = lead_counts.get(cid, 0) + 1
        b = l.get("buildings")
        if b and b.get("name"):
            buildings.setdefault(cid, set()).add(b["name"])
        if l.get("assigned_manager"):
            prev = manager_by_client.get(cid)
            if not prev or l["created_at"] > prev[0]:
                manager_by_client[cid] = (l["created_at"], l["assigned_manager"])
        if not last_activity.get(cid) or l["created_at"] > last_activity[cid]:
            last_activity[cid] = l["created_at"]

    spravka_counts: dict[str, int] = {}
    for s in spravki:
        cid = s.get("client_id")
        if not cid:
            continue
        spravka_counts[cid] = spravka_counts.get(cid, 0) + 1
        units = s.get("units") or {}
        b = units.get("buildings") or {}
        if b.get("name"):
            buildings.setdefault(cid, set()).add(b["name"])
        if not last_activity.get(cid) or s["created_at"] > last_activity[cid]:
            last_activity[cid] = s["created_at"]

    return [{
        **c,
        "leads_count": lead_counts.get(c["id"], 0),
        "spravka_count": spravka_counts.get(c["id"], 0),
        "buildings": sorted(buildings.get(c["id"], set())),
        "assigned_manager": manager_by_client.get(c["id"], (None, None))[1],
        "last_activity_at": last_activity.get(c["id"]),
    } for c in clients]


@router.get("")
def list_clients(user=Depends(get_current_user)):
    client = get_service_client()
    return _list_clients_with_stats(client, user.tenant_id)


@router.post("/ai-segments")
def ai_segment_clients(body: AISegmentsRequest, user=Depends(get_current_user)):
    """Reasons over exactly the client_ids the frontend currently has
    filtered/visible, not the whole tenant -- a boss segmenting "clients
    interested in Milano" gets segments about that subset, not diluted by
    everyone else. Tenant scoping happens by re-deriving stats from
    _list_clients_with_stats (already tenant-scoped) and filtering down to
    the requested ids, never by trusting the request body's ids directly."""
    client = get_service_client()
    all_clients = _list_clients_with_stats(client, user.tenant_id)
    requested = set(body.client_ids)
    summaries = [{
        "id": c["id"],
        "name": c.get("name"),
        "phone": c["phone"],
        "priority": c.get("priority"),
        "leads_count": c["leads_count"],
        "spravka_count": c["spravka_count"],
        "buildings": c.get("buildings", []),
        "assigned_manager": c.get("assigned_manager"),
        "last_activity_at": c.get("last_activity_at"),
    } for c in all_clients if c["id"] in requested]
    if not summaries:
        return {"segments": []}
    try:
        return segment_clients(summaries)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось получить AI-сегменты — попробуйте ещё раз")


@router.get("/{client_id}")
def get_client(client_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    res = client.table("clients").select("*").eq("id", client_id).eq("tenant_id", user.tenant_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Client not found")
    leads = (
        client.table("leads").select("*, buildings(name)")
        .eq("client_id", client_id).order("created_at", desc=True).execute().data
    )
    spravki = (
        client.table("spravka_requests")
        .select("*, units(unit_number, floor, area_m2, buildings(name))")
        .eq("client_id", client_id).order("created_at", desc=True).execute().data
    )
    # Deal timeline needs this client's payment rows too, but payment_schedule
    # only links back through spravka_request_id (no client_id column of its
    # own) -- fetch by the spravka ids just resolved above.
    spravka_ids = [s["id"] for s in spravki]
    payments = (
        client.table("payment_schedule")
        .select("id, spravka_request_id, installment_number, label, due_date, amount_usd, status, paid_at")
        .in_("spravka_request_id", spravka_ids).eq("tenant_id", user.tenant_id).order("due_date").execute().data
        if spravka_ids else []
    )
    return {**res.data[0], "leads": leads, "spravka_requests": spravki, "payments": payments}


@router.post("/{client_id}/context-summary")
def refresh_context_summary(client_id: str, user=Depends(get_current_user)):
    """Manager-handover problem: whoever inherits a departed agent's clients
    has no idea what's been discussed. On-demand (not automatic on every
    event, keeps this cheap and simple) -- a manager clicks "Обновить
    сводку" and gets a fresh 2-4 sentence brief synthesized from everything
    known about this client."""
    client = get_service_client()
    context_data = gather_client_context(client, user.tenant_id, client_id)
    if not context_data:
        raise HTTPException(status_code=404, detail="Client not found")
    try:
        summary = summarize_client_context(context_data)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось обновить сводку — попробуйте ещё раз")
    updated = client.table("clients").update({
        "ai_context_summary": summary, "ai_context_generated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", client_id).eq("tenant_id", user.tenant_id).execute().data
    return updated[0]


@router.patch("/{client_id}/followup")
def update_client_followup(client_id: str, body: ClientFollowupUpdate, user=Depends(get_current_user)):
    """Manual stand-in for a real call log -- there's no telephony/Telegram
    integration to auto-populate this, so a rep logs it themselves right
    after a call (priority + when to reach out next + why)."""
    if body.priority is not None and body.priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail=f"priority must be one of {PRIORITIES}")
    client = get_service_client()
    updates = {k: v for k, v in body.model_dump(mode="json").items() if k in body.model_fields_set}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = (
        client.table("clients").update(updates).eq("id", client_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Client not found")
    return updated[0]
