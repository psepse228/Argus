"""Concurrency stress checks against an in-process ASGI app (no real network,
no real Supabase/OpenAI calls) -- there's no separate staging environment for
Argus (the local dev server points at the same production Supabase project
as everything else), so real load-testing against a live deployment is
deliberately out of scope here. What this DOES verify: the request path
doesn't crash or deadlock under concurrent load, and slowapi's in-memory
rate-limit counter is actually safe under real concurrency (a burst of N
simultaneous requests, not N sequential ones -- a naive read-then-write
counter could race and let more than the limit through).
"""
import asyncio

import httpx
import pytest
from fastapi import FastAPI, Request
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address


def _make_app(limit: str):
    limiter = Limiter(key_func=get_remote_address)
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    @app.get("/ping")
    @limiter.limit(limit)
    def ping(request: Request):
        return {"ok": True}

    return app


async def _fire_concurrent_requests(app, count: int) -> list[int]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        responses = await asyncio.gather(*[client.get("/ping") for _ in range(count)])
    return [r.status_code for r in responses]


def test_concurrent_burst_does_not_exceed_the_configured_limit():
    """50 requests fired at once (same simulated client/IP) against a
    10/minute limit -- exactly 10 must succeed, the rest 429, regardless of
    the race between concurrent counter reads/writes."""
    app = _make_app("10/minute")
    statuses = asyncio.run(_fire_concurrent_requests(app, 50))

    assert statuses.count(200) == 10
    assert statuses.count(429) == 40
    assert all(s in (200, 429) for s in statuses)  # nothing crashed into a 500


def test_concurrent_burst_within_limit_all_succeed():
    app = _make_app("100/minute")
    statuses = asyncio.run(_fire_concurrent_requests(app, 30))

    assert all(s == 200 for s in statuses)


@pytest.mark.parametrize("burst_size", [20, 60, 150])
def test_app_survives_bursts_of_varying_size_without_errors(burst_size):
    """No 500s at any burst size, whatever the rate-limit outcome is --
    this is the actual crash/deadlock check, the exact 200/429 split is
    covered by the tests above."""
    app = _make_app("20/minute")
    statuses = asyncio.run(_fire_concurrent_requests(app, burst_size))

    assert 500 not in statuses
    assert len(statuses) == burst_size
