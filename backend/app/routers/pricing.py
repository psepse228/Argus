"""Direct REST access to the real payment-plan price table — the Справки
section needs this to show real prices when building a new request, not just
via the AI assistant's function-calling path."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user, require_boss

router = APIRouter(prefix="/api/payment-plan-rates")

exchange_rate_router = APIRouter(prefix="/api/exchange-rates")


@router.get("")
def list_payment_plan_rates(building_id: str | None = None, user=Depends(get_current_user)):
    client = get_service_client()
    q = client.table("payment_plan_rates").select("*, buildings(name)").eq("tenant_id", user.tenant_id)
    if building_id:
        q = q.eq("building_id", building_id)
    return q.execute().data


@exchange_rate_router.get("")
def list_exchange_rates(user=Depends(get_current_user)):
    """The курс a Справка actually prices in сум at, per building -- see
    app/services/spravka_service.py::_get_exchange_rate for where this feeds
    into Справка generation (replacing what used to be a hardcoded 12200.0)."""
    client = get_service_client()
    return (
        client.table("pricing_rules").select("building_id, exchange_rate_sum, buildings(name)")
        .eq("tenant_id", user.tenant_id).is_("room_type", "null").execute().data
    )


class ExchangeRateUpdate(BaseModel):
    exchange_rate_sum: float


@exchange_rate_router.patch("/{building_id}")
def update_exchange_rate(building_id: str, body: ExchangeRateUpdate, user=Depends(require_boss)):
    client = get_service_client()
    updated = (
        client.table("pricing_rules").update({"exchange_rate_sum": body.exchange_rate_sum})
        .eq("tenant_id", user.tenant_id).eq("building_id", building_id).is_("room_type", "null").execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="No pricing_rules row for this building yet")
    return updated[0]
