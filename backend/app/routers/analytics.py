"""Boss-only analytics — the richer monitoring view the owner asked for
beyond a shallow approve/reject list. Reuses the same real-data functions the
boss assistant already calls, exposed as plain REST too so the dashboard
doesn't need a chat round-trip just to render numbers."""
from fastapi import APIRouter, Depends

from app.deps import require_boss
from app.ai.functions import get_sales_summary, get_payment_plan_rates

router = APIRouter(prefix="/api/analytics")


@router.get("/summary")
def summary(user=Depends(require_boss)):
    return get_sales_summary(user.tenant_id)


@router.get("/payment-plan-rates")
def rates(user=Depends(require_boss)):
    return get_payment_plan_rates(user.tenant_id)
