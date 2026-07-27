"""Leads API — mirrors Macro's real pipeline stages (see PLANNING.md)."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/leads")

STAGES = ["unsorted", "matching", "meeting_scheduled", "meeting_held", "reserved", "paid_reservation"]

# A lead sitting untouched in an early stage this long is a missed follow-up,
# not just "not yet worked" -- flagged for the boss/rep to notice, not auto-acted on.
STALE_DAYS = 3
STALE_STAGES = {"unsorted", "matching"}


class LeadStageUpdate(BaseModel):
    stage: str


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
    res = (
        client.table("leads")
        .update({"stage": body.stage, "updated_at": datetime.now(timezone.utc).isoformat()})
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
