"""On-demand first-person greeting -- see app/ai/brain_greeting.py. Reuses
the exact same role-scoped sync as brain_items.py's list endpoint (a boss
syncs every manager, a non-boss just themselves) so the greeting always
reflects the same live items the Inbox would show, not a second source of
truth.
"""
from fastapi import APIRouter, Depends

from app.ai.brain_greeting import generate_greeting
from app.db import get_service_client
from app.deps import get_current_user
from app.routers.brain_items import _sync_and_list

router = APIRouter(prefix="/api/brain")


@router.get("/greeting")
def get_greeting(user=Depends(get_current_user)):
    client = get_service_client()
    items = _sync_and_list(client, user.tenant_id, user.role, user.email)
    return {"text": generate_greeting(items)}
