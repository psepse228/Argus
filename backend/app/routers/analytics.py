"""Boss-only analytics — the richer monitoring view the owner asked for
beyond a shallow approve/reject list. Reuses the same real-data functions the
boss assistant already calls, exposed as plain REST too so the dashboard
doesn't need a chat round-trip just to render numbers."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import require_boss
from app.ai.functions import get_sales_summary, get_payment_plan_rates

router = APIRouter(prefix="/api/analytics")


@router.get("/summary")
def summary(user=Depends(require_boss)):
    return get_sales_summary(user.tenant_id)


@router.get("/payment-plan-rates")
def rates(user=Depends(require_boss)):
    return get_payment_plan_rates(user.tenant_id)


@router.get("/commissions")
def commissions(user=Depends(require_boss)):
    """Not a real payroll system -- a flat, boss-editable % per agent applied
    to what's actually been collected (paid installments), not the full deal
    value or anything still pending/overdue."""
    client = get_service_client()
    agents = (
        client.table("tenant_users").select("id, name, email, commission_pct")
        .eq("tenant_id", user.tenant_id).eq("role", "sales_agent").order("name").execute().data
    )
    paid = (
        client.table("payment_schedule").select("amount_usd, spravka_requests(requested_by)")
        .eq("tenant_id", user.tenant_id).eq("status", "paid").execute().data
    )
    collected_by_email: dict[str, float] = {}
    for p in paid:
        email = (p.get("spravka_requests") or {}).get("requested_by")
        if email:
            collected_by_email[email] = collected_by_email.get(email, 0) + float(p["amount_usd"])
    return [
        {
            **a,
            "collected_usd": collected_by_email.get(a["email"], 0),
            "commission_usd": round(collected_by_email.get(a["email"], 0) * float(a["commission_pct"]) / 100, 2),
        }
        for a in agents
    ]


class CommissionRateUpdate(BaseModel):
    commission_pct: float


@router.patch("/commissions/{tenant_user_id}")
def update_commission_rate(tenant_user_id: str, body: CommissionRateUpdate, user=Depends(require_boss)):
    client = get_service_client()
    updated = (
        client.table("tenant_users").update({"commission_pct": body.commission_pct})
        .eq("id", tenant_user_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Agent not found")
    return updated[0]
