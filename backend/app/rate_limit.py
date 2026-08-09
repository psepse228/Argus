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
# SlowAPIMiddleware) -- generous enough that no normal user session should
# ever hit it, just a backstop against a runaway client/script hammering
# the API. Specific expensive endpoints (OpenAI-calling ones) layer a
# tighter @limiter.limit(...) on top where they're declared.
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
