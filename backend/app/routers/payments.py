"""Real installment payment tracking -- a Справка computes a payment plan
once at generation time and otherwise nothing tracks what happens to it
afterward. This is the loan-servicing-style view: what's due, what's paid,
what's overdue, per approved deal. See app/services/payment_schedule_service.py
for how the schedule itself gets generated (on approval).
"""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/payments")


@router.get("")
def list_payments(user=Depends(get_current_user)):
    client = get_service_client()
    q = (
        client.table("payment_schedule")
        .select("*, spravka_requests(client_name, requested_by, units(unit_number, buildings(name)))")
        .eq("tenant_id", user.tenant_id)
    )
    rows = q.order("due_date").execute().data
    if user.role != "boss":
        rows = [r for r in rows if r.get("spravka_requests", {}).get("requested_by") == user.email]
    today = date.today().isoformat()
    for r in rows:
        # Overdue is computed for display, not persisted -- a row only ever
        # really needs to know "paid" or "not yet"; "overdue" is just
        # "not yet, and the date has passed."
        if r["status"] == "pending" and r["due_date"] < today:
            r["status"] = "overdue"
    return rows


@router.post("/{payment_id}/mark-paid")
def mark_paid(payment_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    updated = (
        client.table("payment_schedule").update({
            "status": "paid", "paid_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", payment_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Payment not found")
    return updated[0]
