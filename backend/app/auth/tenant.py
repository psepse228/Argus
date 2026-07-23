"""User/tenant lookup for login.

Deliberate divergence from Cortège/Tender Agent's self-serve
resolve_or_create_tenant_by_email() pattern: Argus does NOT auto-create a
tenant_users row for a new email. Roles (boss vs. sales_agent) are a real
permission distinction, not just a UX convenience — letting anyone who signs
in with Google auto-become a user (and worse, guess a default role) would be
a genuine access-control bug, not just a missing nicety. Rows in
tenant_users must be provisioned ahead of time (see migration 0004's seed).
"""
from dataclasses import dataclass
from typing import Optional

from app.db import get_service_client


class AuthError(Exception):
    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


@dataclass
class TenantUser:
    email: str
    tenant_id: str
    role: str
    name: str


def find_tenant_user_by_email(email: str) -> Optional[TenantUser]:
    """Blocking Supabase call — callers must keep this on a plain `def` path,
    never inside an `async def` handler/dependency body (see
    concepts/fastapi-async-blocking-io in the wiki — this exact bug class hit
    Tender Agent's rebuild 5 times)."""
    client = get_service_client()
    res = (
        client.table("tenant_users")
        .select("email, tenant_id, role, name")
        .eq("email", email)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    row = res.data[0]
    return TenantUser(email=row["email"], tenant_id=row["tenant_id"], role=row["role"], name=row["name"])
