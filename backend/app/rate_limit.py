"""Per-IP rate limiting (slowapi, backed by the `limits` package). In-memory
storage -- correct for Argus's current single-instance Railway deployment;
would need a shared backend (e.g. Redis) the moment this runs on more than
one instance, since each instance would otherwise track its own separate
counters and the effective limit would multiply by instance count.

Requires uvicorn to actually trust Railway's X-Forwarded-For header (see
railway.json's --forwarded-allow-ips) -- without that, every request looks
like it comes from the proxy's own address and the limiter would treat all
callers as one shared bucket instead of limiting each one individually.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

# Baseline applied to every route automatically (see main.py's
# SlowAPIMiddleware) -- keyed by IP, and Ulkan's whole sales office sits
# behind one shared/NAT'd public IP, all making normal dashboard traffic
# (several panels prefetching on load, multiple staff, multiple tabs) at
# once. 300/min is still a real backstop against a runaway client/script,
# just not tight enough to fire during ordinary shared-office use -- a live
# burst test (2026-08-09) showed 120/min getting uncomfortably close under
# a legitimate-looking concurrent burst. Specific expensive endpoints
# (OpenAI-calling ones) layer a much tighter @limiter.limit(...) on top
# where they're declared -- that's the real cost protection, not this.
limiter = Limiter(key_func=get_remote_address, default_limits=["300/minute"])
