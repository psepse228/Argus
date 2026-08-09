"""Leads API — mirrors Macro's real pipeline stages (see PLANNING.md)."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user
from app.services.client_service import get_or_create_client
from app.telegram.matching import normalize_phone

router = APIRouter(prefix="/api/leads")

STAGES = [
    "unsorted", "matching", "meeting_scheduled", "meeting_held",
    "reserved", "paid_reservation", "deal_in_progress", "contract_signed",
]

# A lead sitting untouched in an early stage this long is a missed follow-up,
# not just "not yet worked" -- flagged for the boss/rep to notice, not auto-acted on.
STALE_DAYS = 3
STALE_STAGES = {"unsorted", "matching"}


PRIORITIES = ["hot", "warm", "cold"]


class LeadStageUpdate(BaseModel):
    stage: str


class LeadPriorityUpdate(BaseModel):
    priority: str | None = None


def _auto_assign_unassigned(client, tenant_id: str, leads: list[dict]) -> None:
    """Newly-arrived leads (from the Facebook ads pipeline, no manager set
    yet) get handed to whichever sales agent currently has the fewest leads
    -- recomputed fresh from live data every call, so no separate counter or
    round-robin cursor to keep in sync. Mutates `leads` in place."""
    unassigned = [l for l in leads if not l.get("assigned_manager")]
    if not unassigned:
        return
    agents = (
        client.table("tenant_users").select("name")
        .eq("tenant_id", tenant_id).eq("role", "sales_agent").order("name").execute().data
    )
    if not agents:
        return
    load = {a["name"]: 0 for a in agents}
    for l in leads:
        if l.get("assigned_manager") in load:
            load[l["assigned_manager"]] += 1
    for l in unassigned:
        name = min(load, key=load.get)
        client.table("leads").update({"assigned_manager": name}).eq("id", l["id"]).eq("tenant_id", tenant_id).execute()
        l["assigned_manager"] = name
        load[name] += 1


def _flag_stale(leads: list[dict]) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)
    for l in leads:
        touched_at = l.get("updated_at") or l.get("created_at")
        stale = False
        if touched_at and l["stage"] in STALE_STAGES:
            stale = datetime.fromisoformat(touched_at.replace("Z", "+00:00")) < cutoff
        l["is_stale"] = stale


class LeadCreate(BaseModel):
    client_name: str | None = None
    client_phone: str
    building_id: str | None = None
    source: str | None = None


@router.post("")
def create_lead(body: LeadCreate, user=Depends(get_current_user)):
    """Manual lead intake -- a walk-in, a referral, a phone call, anything
    that doesn't arrive through the Telegram webhook. Found missing during a
    live QA pass (2026-08-10): there was no way at all to add a client/lead
    to Argus by hand, which also meant a tester couldn't create any test
    data. Reuses get_or_create_client so a phone that already has a client
    (or even a prior lead) attaches to the same identity instead of forking
    a duplicate -- same discipline as the Telegram webhook's own intake path.
    assigned_manager is left unset on purpose: list_leads' own
    _auto_assign_unassigned already round-robins any unassigned lead to
    whoever currently has the fewest, the same path a Facebook-ads lead
    takes -- no need for a second assignment rule here."""
    normalized_phone = normalize_phone(body.client_phone)
    digits = normalized_phone.lstrip("+")
    if not (9 <= len(digits) <= 15):
        raise HTTPException(status_code=400, detail="Некорректный номер телефона")
    client = get_service_client()
    if body.building_id:
        owned = (
            client.table("buildings").select("id")
            .eq("id", body.building_id).eq("tenant_id", user.tenant_id).execute().data
        )
        if not owned:
            raise HTTPException(status_code=404, detail="Building not found")
    client_id = get_or_create_client(client, user.tenant_id, normalized_phone, body.client_name)
    inserted = client.table("leads").insert({
        "tenant_id": user.tenant_id, "client_id": client_id, "phone": normalized_phone,
        "building_id": body.building_id, "source": body.source or "Ручной ввод", "stage": "unsorted",
    }).execute().data[0]
    return inserted


@router.get("")
def list_leads(user=Depends(get_current_user)):
    client = get_service_client()
    res = client.table("leads").select("*").eq("tenant_id", user.tenant_id).execute()
    leads = res.data
    _auto_assign_unassigned(client, user.tenant_id, leads)
    _flag_stale(leads)
    return leads


@router.patch("/{lead_id}/stage")
def update_lead_stage(lead_id: str, body: LeadStageUpdate, user=Depends(get_current_user)):
    if body.stage not in STAGES:
        raise HTTPException(status_code=400, detail=f"stage must be one of {STAGES}")
    client = get_service_client()
    updates = {"stage": body.stage, "updated_at": datetime.now(timezone.utc).isoformat()}
    if body.stage == "reserved":
        # Anchor for the 3-day reservation-expiry reminder (Phase 2b) --
        # only set the first time a lead enters this stage, not every time
        # (a lead bouncing in and out of 'reserved' shouldn't keep pushing
        # its deadline back).
        current = (
            client.table("leads").select("stage")
            .eq("id", lead_id).eq("tenant_id", user.tenant_id).execute().data
        )
        if current and current[0]["stage"] != "reserved":
            updates["reserved_at"] = datetime.now(timezone.utc).isoformat()
    res = (
        client.table("leads")
        .update(updates)
        .eq("id", lead_id)
        .eq("tenant_id", user.tenant_id)  # tenant-scoped even though single-tenant today
        .execute()
    )
    # Supabase's .update() returns 200 with an empty list when the filter
    # matches nothing (bad id, or a real id from a different tenant) — that
    # is not the same as success and must not be reported as one.
    if not res.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    return res.data


@router.patch("/{lead_id}/priority")
def update_lead_priority(lead_id: str, body: LeadPriorityUpdate, user=Depends(get_current_user)):
    if body.priority is not None and body.priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail=f"priority must be one of {PRIORITIES}")
    client = get_service_client()
    res = (
        client.table("leads").update({"priority": body.priority})
        .eq("id", lead_id).eq("tenant_id", user.tenant_id).execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    return res.data[0]


@router.post("/{lead_id}/client")
def open_lead_client(lead_id: str, user=Depends(get_current_user)):
    """Resolves (or creates) the client profile behind a lead, so a rep can
    jump from a lead card straight into that person's real profile/chat --
    same identity get_or_create_client already gives Справка creation, just
    triggered from the Лиды board instead."""
    client = get_service_client()
    res = client.table("leads").select("id, phone, client_id").eq("id", lead_id).eq("tenant_id", user.tenant_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    lead = res.data[0]
    if lead.get("client_id"):
        return {"client_id": lead["client_id"]}
    client_id = get_or_create_client(client, user.tenant_id, lead["phone"])
    client.table("leads").update({"client_id": client_id}).eq("id", lead_id).eq("tenant_id", user.tenant_id).execute()
    return {"client_id": client_id}
