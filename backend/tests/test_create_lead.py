"""POST /api/leads -- manual lead intake, added 2026-08-10 after a live QA
pass found there was no way at all to add a client/lead to Argus by hand.
"""
import pytest
from fastapi import HTTPException

import app.routers.leads as router_mod
from app.auth.session import SessionPayload
from tests._fakes import FakeClient


def _user(email="me@x.com", tenant_id="t1") -> SessionPayload:
    return SessionPayload(email=email, tenant_id=tenant_id, role="sales_agent", exp=9999999999.0)


def test_create_lead_creates_a_new_client_and_lead(monkeypatch):
    fake = FakeClient({"clients": [], "leads": []})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.LeadCreate(client_name="Иванов", client_phone="+998900000001")

    result = router_mod.create_lead(body, user=_user())

    assert result["stage"] == "unsorted"
    assert result["phone"] == "+998900000001"
    assert result["tenant_id"] == "t1"
    client_row = next(r for r in fake._tables["clients"] if r["phone"] == "+998900000001")
    assert client_row["name"] == "Иванов"
    assert result["client_id"] == client_row["id"]


def test_create_lead_reuses_an_existing_client_for_the_same_phone(monkeypatch):
    fake = FakeClient({
        "clients": [{"id": "c-existing", "tenant_id": "t1", "phone": "+998900000001", "name": "Иванов"}],
        "leads": [],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.LeadCreate(client_phone="+998900000001")

    result = router_mod.create_lead(body, user=_user())

    assert result["client_id"] == "c-existing"
    assert len(fake._tables["clients"]) == 1  # no duplicate client created


def test_create_lead_rejects_an_invalid_phone(monkeypatch):
    fake = FakeClient({"clients": [], "leads": []})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.LeadCreate(client_phone="123")

    with pytest.raises(HTTPException) as exc_info:
        router_mod.create_lead(body, user=_user())

    assert exc_info.value.status_code == 400
    assert fake._tables["leads"] == []


def test_create_lead_404s_for_a_building_in_another_tenant(monkeypatch):
    fake = FakeClient({
        "clients": [], "leads": [],
        "buildings": [{"id": "b-other", "tenant_id": "other"}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.LeadCreate(client_phone="+998900000001", building_id="b-other")

    with pytest.raises(HTTPException) as exc_info:
        router_mod.create_lead(body, user=_user())

    assert exc_info.value.status_code == 404
    assert fake._tables["leads"] == []


def test_create_lead_defaults_source_to_manual_entry(monkeypatch):
    fake = FakeClient({"clients": [], "leads": []})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.LeadCreate(client_phone="+998900000001")

    result = router_mod.create_lead(body, user=_user())

    assert result["source"] == "Ручной ввод"
