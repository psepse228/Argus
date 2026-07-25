"""Shared Справка creation logic — used by both the REST endpoint
(app/routers/spravka.py, form-driven) and the AI assistant's function-calling
tool (app/ai/functions.py, chat-driven). Kept in one place so the pricing/
generation logic can't drift between the two entry points.
"""
import os
import re
import shutil
import tempfile
from dataclasses import asdict

from app.excel_gen.models import SpravkaInput
from app.excel_gen.writer import build_spravka
from app.storage import upload_spravka

PLAN_TYPES = ["cash", "installment_6", "installment_12", "installment_24"]


class SpravkaCreationError(Exception):
    """Raised for any validation/lookup failure — callers translate this into
    an HTTPException (REST) or a plain error dict the model can read and
    relay back to the user (chat)."""


def _installment_months_from_plan(plan_type: str) -> int | None:
    m = re.match(r"installment_(\d+)", plan_type)
    return int(m.group(1)) if m else None


def _get_unit_by_id(client, unit_id: str, tenant_id: str) -> dict:
    res = client.table("units").select("*").eq("id", unit_id).eq("tenant_id", tenant_id).execute()
    if not res.data:
        raise SpravkaCreationError("Unit not found")
    return res.data[0]


def get_unit_by_number(client, tenant_id: str, unit_number: str, building: str | None = None) -> dict:
    """Resolves a unit the way a rep would refer to it in chat — by its
    number (and optionally building, to disambiguate the same number
    appearing in more than one building)."""
    q = client.table("units").select("*, buildings(name)").eq("tenant_id", tenant_id).eq("unit_number", str(unit_number))
    res = q.execute()
    rows = res.data
    if building:
        rows = [r for r in rows if r.get("buildings", {}).get("name", "").lower() == building.lower()]
    if not rows:
        raise SpravkaCreationError(f"No unit №{unit_number}" + (f" in {building}" if building else "") + " found")
    if len(rows) > 1:
        raise SpravkaCreationError(
            f"More than one unit №{unit_number} exists across buildings — specify which building "
            f"({', '.join(sorted({r['buildings']['name'] for r in rows}))})"
        )
    return rows[0]


def _get_plan_rate(client, tenant_id: str, building_id: str, plan_type: str) -> dict:
    res = (
        client.table("payment_plan_rates").select("*")
        .eq("tenant_id", tenant_id).eq("building_id", building_id).eq("plan_type", plan_type)
        .execute()
    )
    if not res.data:
        raise SpravkaCreationError(f"No rate set for plan '{plan_type}' on this building yet")
    return res.data[0]


def _generate_and_store(req_row: dict, unit: dict, unit_building_name: str,
                         real_price_per_m2: float, exchange_rate: float, manager_name: str) -> tuple[str, dict]:
    """Anchor price stays unit['price_per_m2_usd'] (the illusion/list price);
    the discount down to the real payment-plan price is expressed the same
    way the Excel template already does it (promo_total_usd), reusing the
    existing calc.py logic rather than inventing a second pricing path.

    Generates to a local temp dir first (openpyxl needs a real path to save
    to), uploads the result to Supabase Storage, then discards the temp dir —
    the storage path (not a local disk path) is what gets persisted, so
    generated files survive a backend restart. Also returns the computed
    result as a plain dict (asdict of calc.py's SpravkaResult) so the caller
    can persist it as computed_summary — lets the dashboard show a real
    numeric preview without ever needing to parse the .xlsx file."""
    anchor_price = float(unit["price_per_m2_usd"])
    area = float(unit["area_m2"])
    discount_total_usd = max(0.0, (anchor_price - real_price_per_m2) * area)

    plan_type = req_row["plan_type"]
    installment_months = _installment_months_from_plan(plan_type)

    from datetime import date
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
        result = build_spravka(inp, out_path)
        storage_path = upload_spravka(req_row["tenant_id"], req_row["id"], out_path)
        return storage_path, asdict(result)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def create_spravka(
    client, tenant_id: str, unit_id: str, client_name: str, client_phone: str,
    plan_type: str, requested_by: str, down_payment_pct: float | None = None,
    balloon_months: int | None = None, balloon_monthly_payment_usd: float | None = None,
) -> dict:
    """The single entry point for creating a Справка, regardless of whether
    the caller came from the REST form or the AI assistant. Validates,
    resolves the real payment-plan rate, generates the file, and persists
    everything — raises SpravkaCreationError on any real validation failure."""
    if plan_type not in PLAN_TYPES:
        raise SpravkaCreationError(f"plan_type must be one of {PLAN_TYPES}")
    if plan_type != "cash" and down_payment_pct is None:
        raise SpravkaCreationError("down_payment_pct is required for installment plans")
    if (balloon_months is None) != (balloon_monthly_payment_usd is None):
        raise SpravkaCreationError("balloon_months and balloon_monthly_payment_usd must be set together")

    unit = _get_unit_by_id(client, unit_id, tenant_id)
    building = client.table("buildings").select("name").eq("id", unit["building_id"]).execute().data[0]
    rate = _get_plan_rate(client, tenant_id, unit["building_id"], plan_type)

    row = {
        "tenant_id": tenant_id, "unit_id": unit_id,
        "client_name": client_name, "client_phone": client_phone,
        "requested_by": requested_by, "plan_type": plan_type,
        "down_payment_pct": down_payment_pct,
        "is_full_payment": plan_type == "cash",
        "installment_months": _installment_months_from_plan(plan_type),
        "balloon_months": balloon_months,
        "balloon_monthly_payment_usd": balloon_monthly_payment_usd,
        "status": "pending",  # generated immediately; "pending" now means "awaiting boss review", not "awaiting approval to generate"
    }
    inserted = client.table("spravka_requests").insert(row).execute().data[0]

    file_path, summary = _generate_and_store(
        inserted, unit, building["name"], float(rate["price_per_m2_usd"]),
        12200.0,  # TODO: exchange rate should also be a real per-day input, not hardcoded — flagged for the owner
        requested_by,
    )
    client.table("spravka_requests").update({
        "generated_file_url": file_path, "computed_summary": summary,
    }).eq("id", inserted["id"]).execute()
    inserted["generated_file_url"] = file_path
    inserted["computed_summary"] = summary
    inserted["real_price_per_m2_usd"] = float(rate["price_per_m2_usd"])
    return inserted
