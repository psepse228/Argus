"""Manual smoke test — generates 3 real-shaped examples, run directly with:
    py test_manual.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.excel_gen.models import SpravkaInput
from app.excel_gen.writer import build_spravka

OUT = os.path.join(os.path.dirname(__file__), "_test_output")
os.makedirs(OUT, exist_ok=True)

# 1) Full payment — mirrors "100 % roma.xlsx"
r1 = build_spravka(
    SpravkaInput(
        building="Roma", client_name="Якобова Ойбек", client_phone="+998 90 188 45 07",
        unit_number=123, floor=7, area_m2=64.67,
        price_per_m2_usd_no_promo=1500, exchange_rate=12070,
        is_full_payment=True,
    ),
    os.path.join(OUT, "1_full_payment.xlsx"),
)
print("1) full payment total $:", r1.effective_total_usd)

# 2) Straight installment 30% / 24 months — mirrors "30 проц 24 мес.xlsx"
r2 = build_spravka(
    SpravkaInput(
        building="Milano", client_name="Alexander Makedonski", client_phone="+998 77 777 77 77",
        unit_number=30, floor=7, area_m2=84.05,
        price_per_m2_usd_no_promo=2578, exchange_rate=12000,
        is_full_payment=False, installment_months=24, down_payment_pct=0.30,
    ),
    os.path.join(OUT, "2_installment_30_24.xlsx"),
)
print("2) monthly $:", r2.monthly_payment_usd, "vs real 6319.86")

# 3) Balloon variant — mirrors "последний Task.xlsx"
r3 = build_spravka(
    SpravkaInput(
        building="Milano", client_name="Alexander Makedonski", client_phone="+998 77 777 77 77",
        unit_number=77, floor=6, area_m2=85.2,
        price_per_m2_usd_no_promo=2578, exchange_rate=12000,
        is_full_payment=False, installment_months=24, down_payment_pct=0.40,
        balloon_months=9, balloon_monthly_payment_usd=3000,
    ),
    os.path.join(OUT, "3_balloon.xlsx"),
)
print("3) balloon remaining $:", r3.balloon_remaining_usd, "vs real 104787.36")
