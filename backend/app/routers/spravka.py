"""The core sales workflow, corrected per the owner's real business logic
(2026-07-23): the chess-grid price is an anchor/illusion price. The real
price is a FIXED lookup per payment-plan type (payment_plan_rates), not a
rep-negotiated discount. A rep picks a plan, the system looks up the real
rate, generates the Справка immediately (no pre-approval gate), and it lands
in the boss's queue to confirm or reject afterward — review-after, not
approve-before.

The actual creation logic (validation, pricing lookup, file generation) now
lives in app/services/spravka_service.py, shared with the AI assistant's
chat-driven creation path — this router is a thin REST wrapper over it.
"""
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user, require_boss
from app.excel_gen.preview import workbook_bytes_to_preview
from app.services.spravka_service import PLAN_TYPES, SpravkaCreationError, create_spravka
from app.services.payment_schedule_service import generate_schedule
from app.storage import download_spravka as storage_download

router = APIRouter(prefix="/api/spravka-requests")


class SpravkaRequestCreate(BaseModel):
    unit_id: str
    client_name: str
    client_phone: str
    plan_type: str  # one of PLAN_TYPES — determines the real price via payment_plan_rates
    down_payment_pct: float | None = None  # required unless plan_type == "cash"
    # Optional balloon structure (matches the real "последний Task.xlsx"
    # pattern): a smaller payment for balloon_months, then a lump remainder
    # due. Set both together, or neither for straight linear amortization.
    balloon_months: int | None = None
    balloon_monthly_payment_usd: float | None = None
    # A rep-typed override (e.g. a special deal) -- when set, prices the
    # Справка instead of the fixed payment_plan_rates lookup.
    requested_price_per_m2_usd: float | None = None


@router.post("")
def create_spravka_request(body: SpravkaRequestCreate, user=Depends(get_current_user)):
    client = get_service_client()
    try:
        return create_spravka(
            client, user.tenant_id, body.unit_id, body.client_name, body.client_phone,
            body.plan_type, user.email, body.down_payment_pct,
            body.balloon_months, body.balloon_monthly_payment_usd,
            body.requested_price_per_m2_usd,
        )
    except SpravkaCreationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{request_id}/download")
def download_spravka(request_id: str, user=Depends(get_current_user)):
    """Keyed by request id, not a raw path — a rep should only ever be able
    to download their own tenant's generated files, never an arbitrary
    storage path. The bucket itself is private; this tenant check is the
    only gate standing between a request and the file."""
    client = get_service_client()
    res = client.table("spravka_requests").select("generated_file_url, client_name").eq("id", request_id).eq("tenant_id", user.tenant_id).execute()
    if not res.data or not res.data[0].get("generated_file_url"):
        raise HTTPException(status_code=404, detail="No generated file for this request")
    storage_path = res.data[0]["generated_file_url"]
    try:
        data = storage_download(storage_path)
    except Exception:
        raise HTTPException(status_code=410, detail="Generated file no longer exists in storage")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{os.path.basename(storage_path)}"'},
    )


@router.get("/{request_id}/preview")
def preview_spravka(request_id: str, user=Depends(get_current_user)):
    """Real HUD over the real generated file -- reads the actual stored
    .xlsx (same tenant-ownership gate as download) and returns a styled grid
    (fonts, borders, merges, number formats) for the frontend to render as an
    actual table, so what's shown can never drift from what "Скачать" gives
    you. Not a hand-built numeric summary."""
    client = get_service_client()
    res = client.table("spravka_requests").select("generated_file_url").eq("id", request_id).eq("tenant_id", user.tenant_id).execute()
    if not res.data or not res.data[0].get("generated_file_url"):
        raise HTTPException(status_code=404, detail="No generated file for this request")
    try:
        data = storage_download(res.data[0]["generated_file_url"])
        return workbook_bytes_to_preview(data)
    except Exception:
        raise HTTPException(status_code=410, detail="Generated file no longer exists in storage")


@router.get("")
def list_spravka_requests(user=Depends(get_current_user)):
    """Embeds the unit (number, floor, area) and its building name so the
    dashboard can show a real, readable identifier instead of a raw row id --
    a boss reviewing 5+ pending requests has no way to tell them apart
    otherwise."""
    client = get_service_client()
    q = (
        client.table("spravka_requests")
        .select("*, units(unit_number, floor, area_m2, buildings(name))")
        .eq("tenant_id", user.tenant_id)
    )
    if user.role != "boss":
        q = q.eq("requested_by", user.email)
    return q.order("created_at", desc=True).execute().data


@router.post("/{request_id}/approve")
def approve_spravka_request(request_id: str, user=Depends(require_boss)):
    """Review-after confirmation — the file was already generated at request
    creation time. This just records the boss's decision."""
    client = get_service_client()
    updated = client.table("spravka_requests").update({
        "status": "approved", "approved_by": user.email,
        "approved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", request_id).eq("tenant_id", user.tenant_id).execute().data
    if not updated:
        raise HTTPException(status_code=404, detail="Request not found")
    # Approval is the point the deal becomes real, not just a quote --
    # generate the trackable installment schedule now, reusing the exact
    # numbers already computed at creation time.
    try:
        generate_schedule(client, user.tenant_id, updated[0])
    except Exception:
        pass  # best-effort -- approval itself must not fail if this does
    return updated[0]


@router.post("/{request_id}/reject")
def reject_spravka_request(request_id: str, user=Depends(require_boss)):
    client = get_service_client()
    updated = client.table("spravka_requests").update({
        "status": "rejected", "approved_by": user.email,
        "approved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", request_id).eq("tenant_id", user.tenant_id).execute().data
    if not updated:
        raise HTTPException(status_code=404, detail="Request not found")
    return updated[0]
