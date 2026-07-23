"""Input model for a Справка (quote) — mirrors the real Excel samples exactly."""
from dataclasses import dataclass
from datetime import date
from typing import Optional


@dataclass
class SpravkaInput:
    building: str          # "Milano", "Roma", ...
    client_name: str
    client_phone: str
    unit_number: int        # № (apartment/unit number)
    floor: int              # этаж
    area_m2: float          # квадратура
    price_per_m2_usd_no_promo: float
    exchange_rate: float    # курс — сум per $, varies day to day
    manager_name: str = "Мухаммадризо"

    # promo/акция — 0 if none
    promo_total_usd: float = 0.0

    # payment plan: either full payment, or рассрочка
    is_full_payment: bool = True
    installment_months: Optional[int] = None       # e.g. 12, 24
    down_payment_pct: Optional[float] = None        # e.g. 0.3, 0.5 (as fraction)

    # balloon variant (like "последний Task.xlsx"): pay a smaller amount for
    # `balloon_months` months, then a lump remainder is due — only used when
    # balloon_months is set and differs from installment_months
    balloon_months: Optional[int] = None
    balloon_monthly_payment_usd: Optional[float] = None

    payment_start_date: Optional[date] = None
