"""Real Supabase-backed functions the AI assistants call. Same hallucination
guard as Cortège: the model never stores prices/facts in the prompt, it
always calls these functions for anything factual — see
concepts/multi-tenant-saas-playbook in the wiki ("Hallucination guard:
Function calling. Model never stores prices/facts in the prompt — always
calls Supabase-backed functions.").

Every function here is a plain `def` (not `async def`) since they all do
blocking Supabase calls — see concepts/fastapi-async-blocking-io.
"""
from app.db import get_service_client
from app.services.spravka_service import (
    SpravkaCreationError, create_spravka, get_unit_by_number,
)


def get_units(tenant_id: str, building: str | None = None, room_type: str | None = None,
              max_price_usd: float | None = None, status: str | None = "for_sale") -> list[dict]:
    client = get_service_client()
    q = client.table("units").select("*, buildings(name)").eq("tenant_id", tenant_id)
    if status:
        q = q.eq("status", status)
    # room_type filtered in Python, not via .eq() — GPT calls this with
    # whatever casing/language variant the user used ("студия" vs "Студия"
    # vs "Studio"), and Supabase's .eq() is exact-match, so an LLM-supplied
    # value silently returning zero rows looks identical to "none exist" to
    # the model. Caught live: asking for "студия" (lowercase) genuinely
    # returned 0 rows before this fix despite 31 real matches existing.
    res = q.execute()
    rows = res.data
    if room_type:
        needle = room_type.lower().replace("-", "").replace(" ", "")
        rows = [r for r in rows if needle in (r.get("room_type") or "").lower().replace("-", "").replace(" ", "")]
    if building:
        rows = [r for r in rows if r.get("buildings", {}).get("name", "").lower() == building.lower()]
    if max_price_usd is not None:
        rows = [r for r in rows if float(r["area_m2"]) * float(r["price_per_m2_usd"]) <= max_price_usd]
    # trim to the fields that actually matter for an assistant answer
    return [{
        "unit_number": r["unit_number"], "building": r.get("buildings", {}).get("name"),
        "floor": r["floor"], "room_type": r.get("room_type"), "area_m2": float(r["area_m2"]),
        "price_per_m2_usd": float(r["price_per_m2_usd"]),
        "total_price_usd": round(float(r["area_m2"]) * float(r["price_per_m2_usd"]), 2),
        "status": r["status"],
    } for r in rows[:30]]  # cap — an assistant answer citing 30 units is already too many, not a data limit


def get_pending_approvals(tenant_id: str) -> list[dict]:
    client = get_service_client()
    res = (
        client.table("spravka_requests")
        .select("*, units(unit_number, floor, area_m2, price_per_m2_usd, buildings(name))")
        .eq("tenant_id", tenant_id).eq("status", "pending")
        .execute()
    )
    return [{
        "request_id": r["id"], "client_name": r["client_name"], "client_phone": r["client_phone"],
        "requested_by": r["requested_by"], "requested_discount_pct": float(r["requested_discount_pct"]),
        "unit_number": r["units"]["unit_number"], "building": r["units"]["buildings"]["name"],
        "created_at": r["created_at"],
    } for r in res.data]


def get_sales_summary(tenant_id: str) -> dict:
    """All-time summary (the demo dataset has no real historical spread to
    window by date yet — a real `days` window is a fast follow-up once
    spravka_requests has enough real timestamped volume)."""
    client = get_service_client()
    reqs = client.table("spravka_requests").select("status, requested_discount_pct").eq("tenant_id", tenant_id).execute().data
    units = client.table("units").select("status").eq("tenant_id", tenant_id).execute().data

    by_status = {}
    for u in units:
        by_status[u["status"]] = by_status.get(u["status"], 0) + 1

    approved = [r for r in reqs if r["status"] in ("approved", "auto_approved")]
    pending_count = len([r for r in reqs if r["status"] == "pending"])
    avg_discount = round(sum(float(r["requested_discount_pct"]) for r in approved) / len(approved), 2) if approved else 0

    return {
        "units_by_status": by_status,
        "spravka_requests_pending": pending_count,
        "spravka_requests_approved": len(approved),
        "average_approved_discount_pct": avg_discount,
    }


def get_payment_plan_rates(tenant_id: str, building: str | None = None) -> list[dict]:
    """The real price table — cash/6mo/12mo/24mo per building. This is what
    reps' generated Справки actually price against; the chess-grid number is
    an anchor/illusion price, not this."""
    client = get_service_client()
    res = client.table("payment_plan_rates").select("*, buildings(name)").eq("tenant_id", tenant_id).execute()
    rows = res.data
    if building:
        rows = [r for r in rows if r.get("buildings", {}).get("name", "").lower() == building.lower()]
    return [{
        "building": r.get("buildings", {}).get("name"),
        "plan_type": r["plan_type"], "price_per_m2_usd": float(r["price_per_m2_usd"]),
    } for r in rows]


def set_payment_plan_rate(tenant_id: str, building: str, plan_type: str, price_per_m2_usd: float) -> dict:
    """BOSS-ONLY write capability — see FUNCTION_SCHEMAS_BOSS_ONLY. Never
    exposed to the sales-agent assistant."""
    client = get_service_client()
    b = client.table("buildings").select("id").eq("tenant_id", tenant_id).ilike("name", building).execute().data
    if not b:
        return {"error": f"No building named '{building}'"}
    building_id = b[0]["id"]
    client.table("payment_plan_rates").upsert({
        "tenant_id": tenant_id, "building_id": building_id,
        "plan_type": plan_type, "price_per_m2_usd": price_per_m2_usd,
    }, on_conflict="tenant_id,building_id,plan_type").execute()
    return {"ok": True, "building": building, "plan_type": plan_type, "price_per_m2_usd": price_per_m2_usd}


def create_spravka_request(
    tenant_id: str, requester_email: str, unit_number: str, client_name: str, client_phone: str,
    plan_type: str, down_payment_pct: float | None = None, building: str | None = None,
    balloon_months: int | None = None, balloon_monthly_payment_usd: float | None = None,
    requested_price_per_m2_usd: float | None = None,
) -> dict:
    """Chat-driven Справка creation — a rep describes the deal in plain
    language instead of filling a form; this resolves the unit by number
    (not a raw id, which no rep would type in chat) and reuses the exact
    same pricing/generation logic the REST form uses (see
    app/services/spravka_service.py) so there's no second, drifting code
    path for something this financially real."""
    client = get_service_client()
    try:
        unit = get_unit_by_number(client, tenant_id, unit_number, building)
        result = create_spravka(
            client, tenant_id, unit["id"], client_name, client_phone, plan_type,
            requester_email, down_payment_pct, balloon_months, balloon_monthly_payment_usd,
            requested_price_per_m2_usd,
        )
    except SpravkaCreationError as e:
        return {"error": str(e)}
    return {
        "ok": True, "request_id": result["id"], "status": result["status"],
        "unit_number": unit["unit_number"], "building": unit.get("buildings", {}).get("name"),
        "real_price_per_m2_usd": result["real_price_per_m2_usd"],
        "summary": result.get("computed_summary"),
    }


def get_company_info() -> dict:
    """Static company blurb for the sales-agent info-package assistant —
    real Italiano Vero project details, not invented."""
    return {
        "project_name": "Italiano Vero",
        "developer": "Ulkan Development",
        "buildings": ["Milano (nearly complete)", "Roma (under construction)", "Neapol", "Venice", "Florencia"],
        "description": "Итальянский архитектурный стиль, 5 корпусов, Ташкент.",
    }


FUNCTION_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_units",
            "description": "Search real unit inventory (price, area, floor, status) — always use this instead of guessing a price or availability.",
            "parameters": {
                "type": "object",
                "properties": {
                    "building": {"type": "string", "description": "e.g. Milano, Roma"},
                    "room_type": {"type": "string"},
                    "max_price_usd": {"type": "number"},
                    "status": {"type": "string", "enum": ["for_sale", "reserved", "paid_reservation", "deal_in_progress", "deal_completed", "marketing_reserve"]},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_pending_approvals",
            "description": "List all Справка requests currently waiting on boss approval.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_sales_summary",
            "description": "Overall pipeline/inventory summary: units by status, pending/approved request counts, average approved discount.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_company_info",
            "description": "Real Italiano Vero project/company details for building an info package to send a client.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_payment_plan_rates",
            "description": "The real price per m2 for each payment plan (cash, 6/12/24-month installment) per building — the chess-grid price is only an anchor/illusion price, this is what Справки actually price against.",
            "parameters": {
                "type": "object",
                "properties": {"building": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_spravka_request",
            "description": (
                "Generate a real Справка (price quote document) for a client — the same document a rep "
                "would otherwise build by hand. Use this whenever the user describes a deal in plain "
                "language (unit number, client name/phone, payment plan) instead of asking them to fill "
                "a form. Always confirm the unit number, plan type, and down payment (if not cash) are "
                "present before calling this — ask a follow-up question for anything missing rather than "
                "guessing. The generated file lands in the boss's review queue immediately; it is not "
                "auto-approved."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "unit_number": {"type": "string", "description": "e.g. '38' — as the rep would say it, not a raw id"},
                    "building": {"type": "string", "description": "e.g. Milano — only needed if the same unit number exists in more than one building"},
                    "client_name": {"type": "string"},
                    "client_phone": {"type": "string"},
                    "plan_type": {"type": "string", "enum": ["cash", "installment_6", "installment_12", "installment_24"]},
                    "down_payment_pct": {"type": "number", "description": "Required unless plan_type is 'cash'"},
                    "balloon_months": {"type": "integer", "description": "Optional: months of a smaller payment before a lump-sum remainder (set together with balloon_monthly_payment_usd)"},
                    "balloon_monthly_payment_usd": {"type": "number"},
                    "requested_price_per_m2_usd": {"type": "number", "description": "Optional: a specific price/m2 the rep wants to request (a special deal) instead of the standard rate for this plan. Only set this if the user explicitly asks for a custom price."},
                },
                "required": ["unit_number", "client_name", "client_phone", "plan_type"],
            },
        },
    },
]

# BOSS-ONLY — never included in the sales-agent assistant's tool list. A rep
# being able to silently change the real price table would be a genuine
# access-control bug, not just a missing nicety (same reasoning as
# tenant_users not self-serve-creating roles — see app/auth/tenant.py).
FUNCTION_SCHEMAS_BOSS_ONLY = FUNCTION_SCHEMAS + [
    {
        "type": "function",
        "function": {
            "name": "set_payment_plan_rate",
            "description": "Set/update the real price per m2 for a payment plan on a building. Only the boss can do this.",
            "parameters": {
                "type": "object",
                "properties": {
                    "building": {"type": "string"},
                    "plan_type": {"type": "string", "enum": ["cash", "installment_6", "installment_12", "installment_24"]},
                    "price_per_m2_usd": {"type": "number"},
                },
                "required": ["building", "plan_type", "price_per_m2_usd"],
            },
        },
    },
]


def call_function(name: str, args: dict, tenant_id: str, requester_email: str | None = None):
    if name == "get_units":
        return get_units(tenant_id, **args)
    if name == "get_pending_approvals":
        return get_pending_approvals(tenant_id)
    if name == "get_sales_summary":
        return get_sales_summary(tenant_id)
    if name == "get_company_info":
        return get_company_info()
    if name == "get_payment_plan_rates":
        return get_payment_plan_rates(tenant_id, **args)
    if name == "set_payment_plan_rate":
        return set_payment_plan_rate(tenant_id, **args)
    if name == "create_spravka_request":
        return create_spravka_request(tenant_id, requester_email, **args)
    raise ValueError(f"Unknown function: {name}")
