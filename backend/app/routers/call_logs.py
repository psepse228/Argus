"""Call-outcome logging (Argus Brain Phase 2a): a manager clicks a click-to-
call button, then logs what happened -- взял/не взял/отложил -- since Argus
has no telephony integration and can't detect this automatically (see the
Day 5 telephony decision: click-to-call stays a `tel:` link, not a PBX/AMI
integration). This is the raw signal Phase 2b's daily briefing reasons over
-- "call didn't get picked up -> remind to retry" needs to know a call was
even attempted.

Not nested under /api/leads/{id}/ like the original spec draft assumed -- a
call can be logged from Клиенты/Юниты too, where there's a client_id in
scope but no lead_id, so a flat endpoint that accepts either is the honest
shape for how this is actually used.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/call-logs")

OUTCOMES = ["answered", "no_answer", "postponed"]


class CallLogCreate(BaseModel):
    outcome: str
    lead_id: str | None = None
    client_id: str | None = None


@router.post("")
def log_call(body: CallLogCreate, user=Depends(get_current_user)):
    if body.outcome not in OUTCOMES:
        raise HTTPException(status_code=400, detail=f"outcome must be one of {OUTCOMES}")
    if not body.lead_id and not body.client_id:
        raise HTTPException(status_code=400, detail="lead_id or client_id is required")
    client = get_service_client()
    if body.lead_id:
        owned = (
            client.table("leads").select("id")
            .eq("id", body.lead_id).eq("tenant_id", user.tenant_id).execute().data
        )
        if not owned:
            raise HTTPException(status_code=404, detail="Lead not found")
    if body.client_id:
        owned = (
            client.table("clients").select("id")
            .eq("id", body.client_id).eq("tenant_id", user.tenant_id).execute().data
        )
        if not owned:
            raise HTTPException(status_code=404, detail="Client not found")
    inserted = client.table("call_logs").insert({
        "tenant_id": user.tenant_id, "lead_id": body.lead_id, "client_id": body.client_id,
        "outcome": body.outcome, "logged_by": user.email,
    }).execute().data
    return inserted[0]
