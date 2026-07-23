"""Leads API — mirrors Macro's real pipeline stages (see PLANNING.md)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/leads")

STAGES = ["unsorted", "matching", "meeting_scheduled", "meeting_held", "reserved", "paid_reservation"]


class LeadStageUpdate(BaseModel):
    stage: str


@router.get("")
def list_leads(user=Depends(get_current_user)):
    client = get_service_client()
    res = client.table("leads").select("*").eq("tenant_id", user.tenant_id).execute()
    return res.data


@router.patch("/{lead_id}/stage")
def update_lead_stage(lead_id: str, body: LeadStageUpdate, user=Depends(get_current_user)):
    if body.stage not in STAGES:
        raise HTTPException(status_code=400, detail=f"stage must be one of {STAGES}")
    client = get_service_client()
    res = (
        client.table("leads")
        .update({"stage": body.stage})
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
