"""Generates a real, trackable installment schedule from a Справка's already-
computed payment plan (computed_summary), once the request is approved --
that's the point the deal becomes real, not just a quote. Reuses the exact
numbers already shown to the client in the generated file/UI, rather than
re-deriving amortization math a second time (see excel_gen/calc.py for the
original computation this reads from).
"""
from datetime import date


def _add_months(d: date, months: int) -> date:
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    # clamp the day for months with fewer days (e.g. Jan 31 + 1mo -> Feb 28/29)
    day = min(d.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def generate_schedule(client, tenant_id: str, spravka_request: dict) -> None:
    """spravka_request must include computed_summary and is_full_payment/
    balloon_months/balloon_monthly_payment_usd (the raw row, not the API
    response shape). Idempotent-ish: relies on the unique (spravka_request_id,
    installment_number) constraint -- callers should only call this once per
    approval, but a duplicate call just fails silently on conflict."""
    summary = spravka_request.get("computed_summary")
    if not summary:
        return
    today = date.today()
    rows = []

    if spravka_request.get("is_full_payment"):
        rows.append({
            "installment_number": 0, "label": "Оплата (наличные)",
            "due_date": today.isoformat(), "amount_usd": summary["effective_total_usd"],
        })
    else:
        rows.append({
            "installment_number": 0, "label": "Первый взнос",
            "due_date": today.isoformat(), "amount_usd": summary["down_payment_usd"],
        })
        balloon_months = spravka_request.get("balloon_months")
        balloon_remaining = summary.get("balloon_remaining_usd") or 0
        if balloon_months and balloon_remaining > 0:
            monthly = spravka_request["balloon_monthly_payment_usd"]
            for i in range(1, balloon_months + 1):
                rows.append({
                    "installment_number": i, "label": f"Платёж {i}/{balloon_months}",
                    "due_date": _add_months(today, i).isoformat(), "amount_usd": monthly,
                })
            rows.append({
                "installment_number": balloon_months + 1, "label": "Остаток",
                "due_date": _add_months(today, balloon_months + 1).isoformat(),
                "amount_usd": balloon_remaining,
            })
        else:
            months = spravka_request.get("installment_months") or 0
            monthly = summary["monthly_payment_usd"]
            for i in range(1, months + 1):
                rows.append({
                    "installment_number": i, "label": f"Платёж {i}/{months}",
                    "due_date": _add_months(today, i).isoformat(), "amount_usd": monthly,
                })

    client.table("payment_schedule").insert([
        {**r, "tenant_id": tenant_id, "spravka_request_id": spravka_request["id"]} for r in rows
    ]).execute()
