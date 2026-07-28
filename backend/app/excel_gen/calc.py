"""Pure calculation logic for a Справка, matching the real Excel samples' formulas.

Verified against real files:
- 100 % roma.xlsx (full payment)
- 30 проц 24 мес.xlsx / 50 проц 12 мес.xlsx (straight installment)
- последний Task.xlsx (balloon variant)
"""
from dataclasses import dataclass
from .models import SpravkaInput


@dataclass
class SpravkaResult:
    total_no_promo_usd: float
    total_no_promo_sum: float
    total_promo_usd: float          # 0 if no акция
    total_promo_sum: float
    effective_price_per_m2_usd: float
    effective_price_per_m2_sum: float
    effective_total_usd: float
    effective_total_sum: float

    payment_label: str              # "100% Оплата" or "рассрочка на N"

    down_payment_usd: float = 0.0
    down_payment_sum: float = 0.0
    remaining_usd: float = 0.0
    remaining_sum: float = 0.0
    monthly_payment_usd: float = 0.0
    monthly_payment_sum: float = 0.0
    total_installment_paid_usd: float = 0.0
    total_installment_paid_sum: float = 0.0

    # balloon-only fields
    balloon_remaining_usd: float = 0.0
    balloon_remaining_sum: float = 0.0


def compute(inp: SpravkaInput) -> SpravkaResult:
    total_no_promo_usd = round(inp.area_m2 * inp.price_per_m2_usd_no_promo, 2)
    total_no_promo_sum = round(total_no_promo_usd * inp.exchange_rate, 2)

    total_promo_usd = round(inp.promo_total_usd, 2)
    total_promo_sum = round(total_promo_usd * inp.exchange_rate, 2)

    # "effective" columns (J-M in the real sheet) = post-promo if a promo
    # applies, otherwise identical to the no-promo columns — matches every
    # sample file, where promo=0 and effective == no-promo. promo can be
    # negative (a payment-plan surcharge, e.g. installment priced *above*
    # the cash anchor) -- subtracting a negative correctly adds it back, so
    # this must trigger on != 0, not > 0, or a surcharge silently vanishes
    # and the client gets billed the cheaper anchor price.
    if total_promo_usd != 0:
        effective_total_usd = total_no_promo_usd - total_promo_usd
    else:
        effective_total_usd = total_no_promo_usd
    effective_total_sum = round(effective_total_usd * inp.exchange_rate, 2)
    effective_price_per_m2_usd = round(effective_total_usd / inp.area_m2, 2)
    effective_price_per_m2_sum = round(effective_price_per_m2_usd * inp.exchange_rate, 2)

    if inp.is_full_payment:
        return SpravkaResult(
            total_no_promo_usd=total_no_promo_usd,
            total_no_promo_sum=total_no_promo_sum,
            total_promo_usd=total_promo_usd,
            total_promo_sum=total_promo_sum,
            effective_price_per_m2_usd=effective_price_per_m2_usd,
            effective_price_per_m2_sum=effective_price_per_m2_sum,
            effective_total_usd=effective_total_usd,
            effective_total_sum=effective_total_sum,
            payment_label="100% Оплата",
        )

    assert inp.installment_months and inp.down_payment_pct is not None, \
        "installment_months and down_payment_pct required unless is_full_payment"

    down_usd = round(effective_total_usd * inp.down_payment_pct, 2)
    down_sum = round(down_usd * inp.exchange_rate, 2)
    remaining_usd = round(effective_total_usd - down_usd, 2)
    remaining_sum = round(remaining_usd * inp.exchange_rate, 2)

    if inp.balloon_months and inp.balloon_monthly_payment_usd is not None:
        # partial-then-balloon schedule (последний Task.xlsx pattern)
        monthly_usd = round(inp.balloon_monthly_payment_usd, 2)
        monthly_sum = round(monthly_usd * inp.exchange_rate, 2)
        total_paid_usd = round(monthly_usd * inp.balloon_months, 2)
        total_paid_sum = round(total_paid_usd * inp.exchange_rate, 2)
        balloon_remaining_usd = round(remaining_usd - total_paid_usd, 2)
        balloon_remaining_sum = round(balloon_remaining_usd * inp.exchange_rate, 2)
        return SpravkaResult(
            total_no_promo_usd=total_no_promo_usd,
            total_no_promo_sum=total_no_promo_sum,
            total_promo_usd=total_promo_usd,
            total_promo_sum=total_promo_sum,
            effective_price_per_m2_usd=effective_price_per_m2_usd,
            effective_price_per_m2_sum=effective_price_per_m2_sum,
            effective_total_usd=effective_total_usd,
            effective_total_sum=effective_total_sum,
            payment_label=f"рассрочка на {inp.installment_months} ",
            down_payment_usd=down_usd,
            down_payment_sum=down_sum,
            remaining_usd=remaining_usd,
            remaining_sum=remaining_sum,
            monthly_payment_usd=monthly_usd,
            monthly_payment_sum=monthly_sum,
            total_installment_paid_usd=total_paid_usd,
            total_installment_paid_sum=total_paid_sum,
            balloon_remaining_usd=balloon_remaining_usd,
            balloon_remaining_sum=balloon_remaining_sum,
        )

    # straight linear amortization (30 проц 24 мес / 50 проц 12 мес pattern)
    monthly_usd = round(remaining_usd / inp.installment_months, 2)
    monthly_sum = round(monthly_usd * inp.exchange_rate, 2)
    total_paid_usd = round(monthly_usd * inp.installment_months, 2)
    total_paid_sum = round(total_paid_usd * inp.exchange_rate, 2)

    return SpravkaResult(
        total_no_promo_usd=total_no_promo_usd,
        total_no_promo_sum=total_no_promo_sum,
        total_promo_usd=total_promo_usd,
        total_promo_sum=total_promo_sum,
        effective_price_per_m2_usd=effective_price_per_m2_usd,
        effective_price_per_m2_sum=effective_price_per_m2_sum,
        effective_total_usd=effective_total_usd,
        effective_total_sum=effective_total_sum,
        payment_label=f"рассрочка на {inp.installment_months} ",
        down_payment_usd=down_usd,
        down_payment_sum=down_sum,
        remaining_usd=remaining_usd,
        remaining_sum=remaining_sum,
        monthly_payment_usd=monthly_usd,
        monthly_payment_sum=monthly_sum,
        total_installment_paid_usd=total_paid_usd,
        total_installment_paid_sum=total_paid_sum,
    )
