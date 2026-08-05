"""Журнал AI (ai_events) -- read-side of the transparency log. Tenant-scoped
like everything else in Argus, PLUS role-scoped: a non-boss only ever gets
rows tied to their own manager_email, filtered server-side (never a
client-side filter over the full tenant's data -- a manager's browser
should never even receive another manager's rows). See
docs/superpowers/specs/2026-08-06-ai-events-journal-design.md.
"""
from fastapi import APIRouter, Depends

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/ai-events")


def _query_ai_events(
    client, tenant_id: str, role: str, manager_email: str,
    kind: str | None = None, client_id: str | None = None,
) -> list[dict]:
    """The actual scoping logic, pulled out of the route handler so it's a
    plain function testable with a fake Supabase client -- this is the one
    security-critical boundary in this endpoint (a non-boss must never see
    another manager's rows), so it gets its own direct test coverage even
    though this codebase doesn't generally unit-test router handlers."""
    query = (
        client.table("ai_events").select("*, clients(name, phone)")
        .eq("tenant_id", tenant_id)
    )
    if role != "boss":
        query = query.eq("manager_email", manager_email)
    if kind:
        query = query.eq("kind", kind)
    if client_id:
        query = query.eq("client_id", client_id)
    return query.order("created_at", desc=True).limit(100).execute().data


@router.get("")
def list_ai_events(
    kind: str | None = None, client_id: str | None = None,
    user=Depends(get_current_user),
):
    client = get_service_client()
    return _query_ai_events(client, user.tenant_id, user.role, user.email, kind, client_id)
