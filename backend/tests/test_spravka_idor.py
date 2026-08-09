"""Cross-tenant access and role-scoping regression tests for
app/routers/spravka.py -- see test_clients_idor.py's header comment for the
pattern this follows.
"""
import pytest
from fastapi import HTTPException

import app.routers.spravka as router_mod
from app.auth.session import SessionPayload
from tests._fakes import FakeClient


def _user(email="me@x.com", tenant_id="t1", role="sales_agent") -> SessionPayload:
    return SessionPayload(email=email, tenant_id=tenant_id, role=role, exp=9999999999.0)


def test_download_spravka_404s_for_another_tenants_request(monkeypatch):
    fake = FakeClient({
        "spravka_requests": [{"id": "s-other", "tenant_id": "other", "generated_file_url": "path/to/file.xlsx"}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.download_spravka("s-other", user=_user())

    assert exc_info.value.status_code == 404


def test_preview_spravka_404s_for_another_tenants_request(monkeypatch):
    fake = FakeClient({
        "spravka_requests": [{"id": "s-other", "tenant_id": "other", "generated_file_url": "path/to/file.xlsx"}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.preview_spravka("s-other", user=_user())

    assert exc_info.value.status_code == 404


def test_approve_spravka_404s_and_does_not_mutate_another_tenants_request(monkeypatch):
    fake = FakeClient({
        "spravka_requests": [{"id": "s-other", "tenant_id": "other", "status": "pending", "unit_id": "u1"}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.approve_spravka_request("s-other", user=_user(role="boss"))

    assert exc_info.value.status_code == 404
    assert fake._tables["spravka_requests"][0]["status"] == "pending"


def test_reject_spravka_404s_for_another_tenants_request(monkeypatch):
    fake = FakeClient({
        "spravka_requests": [{"id": "s-other", "tenant_id": "other", "status": "pending"}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.reject_spravka_request("s-other", user=_user(role="boss"))

    assert exc_info.value.status_code == 404


def test_list_spravka_requests_non_boss_only_sees_own_requests(monkeypatch):
    fake = FakeClient({
        "spravka_requests": [
            {"id": "s-mine", "tenant_id": "t1", "requested_by": "me@x.com", "created_at": "2026-01-01T00:00:00+00:00"},
            {"id": "s-colleague", "tenant_id": "t1", "requested_by": "other-agent@x.com", "created_at": "2026-01-01T00:00:00+00:00"},
        ],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    result = router_mod.list_spravka_requests(user=_user(role="sales_agent"))

    ids = {r["id"] for r in result}
    assert ids == {"s-mine"}


def test_list_spravka_requests_boss_sees_every_managers_requests(monkeypatch):
    fake = FakeClient({
        "spravka_requests": [
            {"id": "s-1", "tenant_id": "t1", "requested_by": "agent1@x.com", "created_at": "2026-01-01T00:00:00+00:00"},
            {"id": "s-2", "tenant_id": "t1", "requested_by": "agent2@x.com", "created_at": "2026-01-01T00:00:00+00:00"},
        ],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    result = router_mod.list_spravka_requests(user=_user(role="boss"))

    ids = {r["id"] for r in result}
    assert ids == {"s-1", "s-2"}
