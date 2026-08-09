"""Cross-tenant access regression tests for app/routers/leads.py -- see
test_clients_idor.py's header comment for the pattern this follows.
"""
import pytest
from fastapi import HTTPException

import app.routers.leads as router_mod
from app.auth.session import SessionPayload
from tests._fakes import FakeClient


def _user(email="me@x.com", tenant_id="t1") -> SessionPayload:
    return SessionPayload(email=email, tenant_id=tenant_id, role="sales_agent", exp=9999999999.0)


def test_update_lead_stage_404s_and_does_not_mutate_another_tenants_lead(monkeypatch):
    fake = FakeClient({
        "leads": [{"id": "lead-other", "tenant_id": "other", "stage": "unsorted"}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.LeadStageUpdate(stage="reserved")

    with pytest.raises(HTTPException) as exc_info:
        router_mod.update_lead_stage("lead-other", body, user=_user())

    assert exc_info.value.status_code == 404
    row = next(r for r in fake._tables["leads"] if r["id"] == "lead-other")
    assert row["stage"] == "unsorted"


def test_update_lead_priority_404s_for_another_tenants_lead(monkeypatch):
    fake = FakeClient({
        "leads": [{"id": "lead-other", "tenant_id": "other", "priority": None}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.LeadPriorityUpdate(priority="hot")

    with pytest.raises(HTTPException) as exc_info:
        router_mod.update_lead_priority("lead-other", body, user=_user())

    assert exc_info.value.status_code == 404
    assert fake._tables["leads"][0]["priority"] is None


def test_open_lead_client_404s_for_another_tenants_lead(monkeypatch):
    fake = FakeClient({
        "leads": [{"id": "lead-other", "tenant_id": "other", "phone": "+998000000001", "client_id": None}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.open_lead_client("lead-other", user=_user())

    assert exc_info.value.status_code == 404


def test_list_leads_never_returns_another_tenants_rows(monkeypatch):
    fake = FakeClient({
        "leads": [
            {"id": "l-mine", "tenant_id": "t1", "stage": "unsorted", "assigned_manager": "Кто-то", "created_at": "2026-01-01T00:00:00+00:00"},
            {"id": "l-other", "tenant_id": "other", "stage": "unsorted", "assigned_manager": "Кто-то", "created_at": "2026-01-01T00:00:00+00:00"},
        ],
        "tenant_users": [],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    result = router_mod.list_leads(user=_user())

    ids = {l["id"] for l in result}
    assert ids == {"l-mine"}
