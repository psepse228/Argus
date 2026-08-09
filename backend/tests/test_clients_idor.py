"""Cross-tenant access ("IDOR") regression tests for app/routers/clients.py --
every row in this file's fixtures belongs to tenant "other", and every
request below is made as a user of tenant "t1". If tenant scoping is ever
accidentally dropped from one of these handlers, these tests catch it.
"""
import pytest
from fastapi import HTTPException

import app.routers.clients as router_mod
from app.auth.session import SessionPayload
from tests._fakes import FakeClient


def _user(email="me@x.com", tenant_id="t1", role="sales_agent") -> SessionPayload:
    return SessionPayload(email=email, tenant_id=tenant_id, role=role, exp=9999999999.0)


def test_list_clients_never_returns_another_tenants_rows(monkeypatch):
    fake = FakeClient({
        "clients": [
            {"id": "c-mine", "tenant_id": "t1", "name": "Мой клиент", "created_at": "2026-01-01T00:00:00+00:00"},
            {"id": "c-other", "tenant_id": "other", "name": "Чужой клиент", "created_at": "2026-01-01T00:00:00+00:00"},
        ],
        "leads": [], "spravka_requests": [],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    result = router_mod.list_clients(user=_user())

    ids = {c["id"] for c in result}
    assert ids == {"c-mine"}


def test_get_client_404s_for_another_tenants_client(monkeypatch):
    fake = FakeClient({
        "clients": [{"id": "c-other", "tenant_id": "other", "name": "Чужой клиент"}],
        "leads": [], "spravka_requests": [], "payment_schedule": [],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.get_client("c-other", user=_user())

    assert exc_info.value.status_code == 404


def test_update_client_followup_404s_and_does_not_mutate_another_tenants_row(monkeypatch):
    fake = FakeClient({
        "clients": [{"id": "c-other", "tenant_id": "other", "priority": None}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.ClientFollowupUpdate(priority="hot")

    with pytest.raises(HTTPException) as exc_info:
        router_mod.update_client_followup("c-other", body, user=_user())

    assert exc_info.value.status_code == 404
    row = next(r for r in fake._tables["clients"] if r["id"] == "c-other")
    assert row["priority"] is None  # untouched -- the update must never have applied


def test_ai_segment_clients_ignores_ids_outside_the_caller_tenant(monkeypatch):
    """body.client_ids is attacker-controlled input -- the endpoint must
    derive the actual client set from _list_clients_with_stats (already
    tenant-scoped) and intersect, never trust an id straight from the
    request body."""
    fake = FakeClient({
        "clients": [
            {"id": "c-mine", "tenant_id": "t1", "name": "Мой", "phone": "+998000000001", "created_at": "2026-01-01T00:00:00+00:00"},
            {"id": "c-other", "tenant_id": "other", "name": "Чужой", "phone": "+998000000002", "created_at": "2026-01-01T00:00:00+00:00"},
        ],
        "leads": [], "spravka_requests": [],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    captured = {}

    def fake_segment(summaries):
        captured["summaries"] = summaries
        return {"segments": []}

    monkeypatch.setattr(router_mod, "segment_clients", fake_segment)
    body = router_mod.AISegmentsRequest(client_ids=["c-mine", "c-other"])

    router_mod.ai_segment_clients(body, user=_user())

    seen_ids = {s["id"] for s in captured["summaries"]}
    assert seen_ids == {"c-mine"}
