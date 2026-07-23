"""Direct REST access to the real payment-plan price table — the Справки
section needs this to show real prices when building a new request, not just
via the AI assistant's function-calling path."""
from fastapi import APIRouter, Depends

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/payment-plan-rates")


@router.get("")
def list_payment_plan_rates(building_id: str | None = None, user=Depends(get_current_user)):
    client = get_service_client()
    q = client.table("payment_plan_rates").select("*, buildings(name)").eq("tenant_id", user.tenant_id)
    if building_id:
        q = q.eq("building_id", building_id)
    return q.execute().data
