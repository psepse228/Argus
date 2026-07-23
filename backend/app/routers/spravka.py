"""The core sales workflow, corrected per the owner's real business logic
(2026-07-23): the chess-grid price is an anchor/illusion price. The real
price is a FIXED lookup per payment-plan type (payment_plan_rates), not a
rep-negotiated discount. A rep picks a plan, the system looks up the real
rate, generates the Справка immediately (no pre-approval gate), and it lands
in the boss's queue to confirm or reject afterward — review-after, not
approve-before.
"""
import os
import re
import shutil
import tempfile
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user, require_boss
from app.excel_gen.models import SpravkaInput
from app.excel_gen.writer import build_spravka
from app.storage import download_spravka as storage_download, upload_spravka

router = APIRouter(prefix="/api/spravka-requests")

PLAN_TYPES = ["cash", "installment_6", "installment_12", "installment_24"]


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


def _get_unit(client, unit_id: str, tenant_id: str) -> dict:
    res = client.table("units").select("*").eq("id", unit_id).eq("tenant_id", tenant_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Unit not found")
    return res.data[0]


def _get_plan_rate(client, tenant_id: str, building_id: str, plan_type: str) -> dict:
    res = (
        client.table("payment_plan_rates").select("*")
        .eq("tenant_id", tenant_id).eq("building_id", building_id).eq("plan_type", plan_type)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=400, detail=f"No rate set for plan '{plan_type}' on this building yet")
    return res.data[0]


def _installment_months_from_plan(plan_type: str) -> int | None:
    m = re.match(r"installment_(\d+)", plan_type)
    return int(m.group(1)) if m else None


def _generate_and_store(req_row: dict, unit: dict, unit_building_name: str,
                         real_price_per_m2: float, exchange_rate: float, manager_name: str) -> str:
    """Anchor price stays unit['price_per_m2_usd'] (the illusion/list price);
    the discount down to the real payment-plan price is expressed the same
    way the Excel template already does it (promo_total_usd), reusing the
    existing calc.py logic rather than inventing a second pricing path.

    Generates to a local temp dir first (openpyxl needs a real path to save
    to), uploads the result to Supabase Storage, then discards the temp dir —
    the storage path (not a local disk path) is what gets persisted, so
    generated files survive a backend restart."""
    anchor_price = float(unit["price_per_m2_usd"])
    area = float(unit["area_m2"])
    discount_total_usd = max(0.0, (anchor_price - real_price_per_m2) * area)

    plan_type = req_row["plan_type"]
    installment_months = _installment_months_from_plan(plan_type)

    inp = SpravkaInput(
        building=unit_building_name,
        client_name=req_row["client_name"], client_phone=req_row["client_phone"],
        unit_number=unit["unit_number"], floor=unit["floor"], area_m2=area,
        price_per_m2_usd_no_promo=anchor_price, exchange_rate=exchange_rate,
        manager_name=manager_name,
        promo_total_usd=discount_total_usd,
        is_full_payment=(plan_type == "cash"),
        installment_months=installment_months,
        down_payment_pct=(req_row["down_payment_pct"] / 100) if req_row.get("down_payment_pct") else None,
        balloon_months=req_row.get("balloon_months"),
        balloon_monthly_payment_usd=req_row.get("balloon_monthly_payment_usd"),
        payment_start_date=date.today(),
    )
    tmp_dir = tempfile.mkdtemp()
    try:
        out_path = os.path.join(tmp_dir, f"spravka_{req_row['id']}.xlsx")
        build_spravka(inp, out_path)
        return upload_spravka(req_row["tenant_id"], req_row["id"], out_path)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@router.post("")
def create_spravka_request(body: SpravkaRequestCreate, user=Depends(get_current_user)):
    if body.plan_type not in PLAN_TYPES:
        raise HTTPException(status_code=400, detail=f"plan_type must be one of {PLAN_TYPES}")
    if body.plan_type != "cash" and body.down_payment_pct is None:
        raise HTTPException(status_code=400, detail="down_payment_pct is required for installment plans")
    if (body.balloon_months is None) != (body.balloon_monthly_payment_usd is None):
        raise HTTPException(status_code=400, detail="balloon_months and balloon_monthly_payment_usd must be set together")

    client = get_service_client()
    unit = _get_unit(client, body.unit_id, user.tenant_id)
    building = client.table("buildings").select("name").eq("id", unit["building_id"]).execute().data[0]

    rate = _get_plan_rate(client, user.tenant_id, unit["building_id"], body.plan_type)

    row = {
        "tenant_id": user.tenant_id, "unit_id": body.unit_id,
        "client_name": body.client_name, "client_phone": body.client_phone,
        "requested_by": user.email, "plan_type": body.plan_type,
        "down_payment_pct": body.down_payment_pct,
        "is_full_payment": body.plan_type == "cash",
        "installment_months": _installment_months_from_plan(body.plan_type),
        "balloon_months": body.balloon_months,
        "balloon_monthly_payment_usd": body.balloon_monthly_payment_usd,
        "status": "pending",  # generated immediately; "pending" now means "awaiting boss review", not "awaiting approval to generate"
    }
    inserted = client.table("spravka_requests").insert(row).execute().data[0]

    file_path = _generate_and_store(
        inserted, unit, building["name"], float(rate["price_per_m2_usd"]),
        12200.0,  # TODO: exchange rate should also be a real per-day input, not hardcoded — flagged for the owner
        user.email,
    )
    client.table("spravka_requests").update({"generated_file_url": file_path}).eq("id", inserted["id"]).execute()
    inserted["generated_file_url"] = file_path
    inserted["real_price_per_m2_usd"] = float(rate["price_per_m2_usd"])
    return inserted


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


@router.get("")
def list_spravka_requests(user=Depends(get_current_user)):
    client = get_service_client()
    q = client.table("spravka_requests").select("*").eq("tenant_id", user.tenant_id)
    if user.role != "boss":
        q = q.eq("requested_by", user.email)
    return q.execute().data


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
