"""Argus currently serves a single real tenant (Ulkan Development, based in
Tashkent) -- every "today" boundary an AI-facing feature computes must be
judged in that tenant's local time, not the server's UTC clock. A live QA
pass (2026-08-10) caught the company-summary AI reporting a real event from
the previous evening as "today, at 12:00" -- the underlying bug: brain.py's
gather_company_context computed "today" via datetime.now(timezone.utc).date(),
which briefly disagrees with Tashkent's actual calendar date every day (UTC
19:00-23:59 is already tomorrow in Tashkent, UTC+5), and passed the event's
raw UTC time (12:00) to the model instead of its real local time (17:00).

A fixed +5 offset (not a real IANA zone lookup via zoneinfo) is correct and
simpler here: Uzbekistan has used a flat UTC+5 with no DST since 1992, so
there's no seasonal transition to get wrong, and it avoids depending on the
system tzdata database being installed (not a given on Windows dev
machines). If Argus ever serves a tenant in a different timezone, this
becomes a per-tenant setting instead of a single constant.
"""
from datetime import timedelta, timezone

TENANT_TZ = timezone(timedelta(hours=5))
