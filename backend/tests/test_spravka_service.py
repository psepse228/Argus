"""app/services/spravka_service.py's create_spravka had zero test coverage
before this file. Focus here is the double-submit guard added 2026-08-10
after a live QA pass found real duplicate pending справки in production
(3 separate rows for the same unit+client) -- there was previously no check
at all preventing a second identical submission while one was already
pending.
"""
import pytest

import app.services.spravka_service as mod
from tests._fakes import FakeClient


def _base_tables(**overrides):
    tables = {
        "spravka_requests": [],
        "units": [{"id": "unit-1", "tenant_id": "t1", "building_id": "b1", "unit_number": "104", "price_per_m2_usd": 1400, "area_m2": 50, "floor": 3}],
        "buildings": [{"id": "b1", "tenant_id": "t1", "name": "Milano"}],
        "payment_plan_rates": [{"tenant_id": "t1", "building_id": "b1", "plan_type": "cash", "price_per_m2_usd": 1400}],
        "pricing_rules": [],
        "clients": [],
    }
    tables.update(overrides)
    return tables


def _stub_file_generation(monkeypatch):
    """create_spravka's file-generation tail (openpyxl + Supabase Storage)
    is out of scope for this test file -- stub it so tests focus on the
    dedup guard and DB row shape."""
    monkeypatch.setattr(mod, "_generate_and_store", lambda *a, **k: ("storage/path.xlsx", {"effective_total_usd": 70000}))


def test_create_spravka_succeeds_when_no_pending_request_exists(monkeypatch):
    _stub_file_generation(monkeypatch)
    fake = FakeClient(_base_tables())

    result = mod.create_spravka(fake, "t1", "unit-1", "Иванов", "+998900000001", "cash", "agent@x.com")

    assert result["status"] == "pending"
    assert len(fake._tables["spravka_requests"]) == 1


def test_create_spravka_blocks_a_duplicate_while_one_is_pending(monkeypatch):
    _stub_file_generation(monkeypatch)
    fake = FakeClient(_base_tables(spravka_requests=[
        {"id": "existing-1", "tenant_id": "t1", "unit_id": "unit-1", "client_phone": "+998900000001", "status": "pending"},
    ]))

    with pytest.raises(mod.SpravkaCreationError, match="уже есть справка"):
        mod.create_spravka(fake, "t1", "unit-1", "Иванов", "+998900000001", "cash", "agent@x.com")

    assert len(fake._tables["spravka_requests"]) == 1  # no duplicate inserted


def test_create_spravka_allows_a_new_request_once_the_old_one_is_decided(monkeypatch):
    """A rejected/approved request must never block a legitimate new
    submission -- only a still-open 'pending' one should."""
    _stub_file_generation(monkeypatch)
    fake = FakeClient(_base_tables(spravka_requests=[
        {"id": "existing-1", "tenant_id": "t1", "unit_id": "unit-1", "client_phone": "+998900000001", "status": "rejected"},
    ]))

    result = mod.create_spravka(fake, "t1", "unit-1", "Иванов", "+998900000001", "cash", "agent@x.com")

    assert result["status"] == "pending"
    assert len(fake._tables["spravka_requests"]) == 2


def test_create_spravka_does_not_block_a_pending_request_for_a_different_client(monkeypatch):
    _stub_file_generation(monkeypatch)
    fake = FakeClient(_base_tables(spravka_requests=[
        {"id": "existing-1", "tenant_id": "t1", "unit_id": "unit-1", "client_phone": "+998900000099", "status": "pending"},
    ]))

    result = mod.create_spravka(fake, "t1", "unit-1", "Иванов", "+998900000001", "cash", "agent@x.com")

    assert result["status"] == "pending"


def test_create_spravka_does_not_block_a_pending_request_for_a_different_unit(monkeypatch):
    _stub_file_generation(monkeypatch)
    fake = FakeClient(_base_tables(spravka_requests=[
        {"id": "existing-1", "tenant_id": "t1", "unit_id": "unit-other", "client_phone": "+998900000001", "status": "pending"},
    ]))

    result = mod.create_spravka(fake, "t1", "unit-1", "Иванов", "+998900000001", "cash", "agent@x.com")

    assert result["status"] == "pending"
