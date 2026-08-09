"""Covers the rate-limiting wiring itself (app/rate_limit.py + main.py) --
per-route usage (e.g. telegram_brain.send_now, assistant.py's chat
endpoints) is exercised with the limiter disabled in their own test files,
since those tests call the handler function directly rather than through a
real ASGI request. This file is the one place that proves slowapi's
decorator + SlowAPIMiddleware combination actually rejects a caller who
goes over the limit, using a small throwaway app rather than the full
app.main (which would otherwise need real Supabase/OpenAI/session env
setup just to exercise an unrelated concern).
"""
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi import Limiter
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


def test_requests_within_limit_all_succeed():
    client = TestClient(_make_app("3/minute"))
    for _ in range(3):
        assert client.get("/ping").status_code == 200


def test_request_over_limit_gets_429():
    client = TestClient(_make_app("2/minute"))
    assert client.get("/ping").status_code == 200
    assert client.get("/ping").status_code == 200
    resp = client.get("/ping")
    assert resp.status_code == 429


def test_main_app_wires_up_the_shared_limiter():
    from app.main import app
    from app.rate_limit import limiter as shared_limiter

    assert app.state.limiter is shared_limiter
    assert RateLimitExceeded in app.exception_handlers


def test_health_endpoint_is_exempt_from_rate_limiting():
    """Regression test for a real bug found via a live concurrency burst
    (2026-08-09): /health used to share the global default limit, so a
    burst of concurrent Railway health checks (or anything else hitting it)
    could 429 -- Railway reads a failing health check as "app is down" and
    can cycle a perfectly healthy deployment."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    statuses = [client.get("/health").status_code for _ in range(150)]

    assert all(s == 200 for s in statuses)
