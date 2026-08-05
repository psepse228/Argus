"""Argus Brain Phase 2b: the cached, AI-prioritized "На сегодня" list.
Generated at most once per manager per ~4h window (see _is_stale below) --
never on every page load, matching the cost-control decision in
docs/superpowers/specs/2026-08-05-argus-brain-design.md. GET returns the
cached copy if it's fresh, regenerating only if stale or missing; POST
/refresh always regenerates (the explicit "Обновить" button).
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.ai.brain import gather_manager_context
from app.ai.daily_briefing import generate_daily_briefing
from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/brain")

_STALE_AFTER = timedelta(hours=4)


def _regenerate(client, tenant_id: str, user_email: str, today: str) -> list[dict]:
    facts = gather_manager_context(client, tenant_id, user_email)
    try:
        items = generate_daily_briefing(facts)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось обновить список задач — попробуйте ещё раз")
    payload = {
        "tenant_id": tenant_id, "user_email": user_email, "briefing_date": today,
        "items": items, "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    existing = (
        client.table("daily_briefings").select("id")
        .eq("tenant_id", tenant_id).eq("user_email", user_email).eq("briefing_date", today)
        .execute().data
    )
    if existing:
        client.table("daily_briefings").update(payload).eq("id", existing[0]["id"]).execute()
    else:
        try:
            client.table("daily_briefings").insert(payload).execute()
        except Exception:
            # Race: a concurrent request for this same manager/day already
            # inserted between our SELECT and this INSERT (e.g. two tabs
            # open, or a reload mid-flight during the multi-second OpenAI
            # call). Fall back to an update instead of surfacing a 500 for
            # what is, from the caller's perspective, a successful refresh.
            client.table("daily_briefings").update(payload).eq("tenant_id", tenant_id).eq("user_email", user_email).eq("briefing_date", today).execute()
    return items


@router.get("/daily-briefing")
def get_daily_briefing(user=Depends(get_current_user)):
    client = get_service_client()
    today = datetime.now(timezone.utc).date().isoformat()
    cached = (
        client.table("daily_briefings").select("*")
        .eq("tenant_id", user.tenant_id).eq("user_email", user.email).eq("briefing_date", today)
        .execute().data
    )
    if cached:
        generated_at = datetime.fromisoformat(cached[0]["generated_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - generated_at < _STALE_AFTER:
            return cached[0]["items"]
    return _regenerate(client, user.tenant_id, user.email, today)


@router.post("/daily-briefing/refresh")
def refresh_daily_briefing(user=Depends(get_current_user)):
    client = get_service_client()
    today = datetime.now(timezone.utc).date().isoformat()
    return _regenerate(client, user.tenant_id, user.email, today)
