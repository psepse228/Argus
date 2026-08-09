import logging
import os

from dotenv import load_dotenv
load_dotenv()  # unlike Next.js, plain uvicorn does not auto-load .env — must be explicit

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.rate_limit import limiter
from app.routers import auth_google, units, leads, spravka, assistant, pricing, analytics, clients, conversations, payments, workspace, telegram_business, calendar, call_logs, ai_events, daily_briefing, company_summary, brain_items, brain_greeting, telegram_brain

logger = logging.getLogger(__name__)

app = FastAPI(title="Argus — sales ops")

app.add_middleware(
    CORSMiddleware,
    # wildcard + credentials is invalid per browser spec — must be an exact origin
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Added after CORSMiddleware above -- Starlette wraps middleware in reverse
# insertion order, so this ends up INSIDE CORSMiddleware, meaning a 429
# response still gets CORS headers attached on the way back out instead of
# the browser reporting a confusing CORS error over the real rate-limit one.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Starlette's default unhandled-exception path returns a bare 500 that
    # bypasses CORSMiddleware entirely (that middleware only ever sees
    # responses that complete normally through it) -- the browser then
    # reports a confusing "CORS policy" error instead of the real failure.
    # Registering a handler here means FastAPI's ExceptionMiddleware catches
    # it and hands CORSMiddleware a normal response to attach headers to,
    # same as any other route. See app/db.py for the specific transient
    # error (stale pooled Supabase connection) this was written for.
    logger.exception("Unhandled exception")
    return JSONResponse(status_code=500, content={"detail": "Внутренняя ошибка сервера — попробуйте ещё раз"})

app.include_router(auth_google.router)
app.include_router(auth_google.me_router)
app.include_router(units.router)
app.include_router(leads.router)
app.include_router(spravka.router)
app.include_router(assistant.router)
app.include_router(pricing.router)
app.include_router(pricing.exchange_rate_router)
app.include_router(analytics.router)
app.include_router(clients.router)
app.include_router(conversations.router)
app.include_router(payments.router)
app.include_router(workspace.router)
app.include_router(telegram_business.router)
app.include_router(telegram_business.api_router)
app.include_router(calendar.router)
app.include_router(call_logs.router)
app.include_router(ai_events.router)
app.include_router(daily_briefing.router)
app.include_router(company_summary.router)
app.include_router(brain_items.router)
app.include_router(brain_greeting.router)
app.include_router(telegram_brain.router)


@app.get("/health")
def health():
    return {"status": "ok"}
