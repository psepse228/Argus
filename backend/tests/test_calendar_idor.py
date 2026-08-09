"""Cross-tenant access regression tests for app/routers/calendar.py -- see
test_clients_idor.py's header comment for the pattern this follows.
"""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import app.routers.calendar as router_mod
from app.auth.session import SessionPayload
from tests._fakes import FakeClient


def _user(email="me@x.com", tenant_id="t1") -> SessionPayload:
    return SessionPayload(email=email, tenant_id=tenant_id, role="sales_agent", exp=9999999999.0)


def test_create_event_404s_for_a_client_id_in_another_tenant(monkeypatch):
    fake = FakeClient({
        "clients": [{"id": "c-other", "tenant_id": "other"}],
        "calendar_events": [],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.CalendarEventCreate(title="Показ", event_at=datetime.now(timezone.utc), client_id="c-other")

    with pytest.raises(HTTPException) as exc_info:
        router_mod.create_event(body, user=_user())

    assert exc_info.value.status_code == 404
    assert fake._tables["calendar_events"] == []  # nothing got inserted


def test_update_event_404s_and_does_not_mutate_another_tenants_event(monkeypatch):
    fake = FakeClient({
        "calendar_events": [{"id": "e-other", "tenant_id": "other", "title": "Оригинал"}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.CalendarEventUpdate(title="Подмена")

    with pytest.raises(HTTPException) as exc_info:
        router_mod.update_event("e-other", body, user=_user())

    assert exc_info.value.status_code == 404
    assert fake._tables["calendar_events"][0]["title"] == "Оригинал"


def test_confirm_event_404s_for_another_tenants_event(monkeypatch):
    fake = FakeClient({
        "calendar_events": [{"id": "e-other", "tenant_id": "other", "status": "proposed"}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.confirm_event("e-other", user=_user())

    assert exc_info.value.status_code == 404
    assert fake._tables["calendar_events"][0]["status"] == "proposed"


def test_dismiss_event_404s_for_another_tenants_event(monkeypatch):
    fake = FakeClient({
        "calendar_events": [{"id": "e-other", "tenant_id": "other", "status": "proposed"}],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.dismiss_event("e-other", user=_user())

    assert exc_info.value.status_code == 404


def test_add_meeting_note_404s_for_another_tenants_event(monkeypatch):
    fake = FakeClient({
        "calendar_events": [{"id": "e-other", "tenant_id": "other", "client_id": None}],
        "meeting_notes": [],
    })
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    body = router_mod.MeetingNoteCreate(note="Прошло хорошо")

    with pytest.raises(HTTPException) as exc_info:
        router_mod.add_meeting_note("e-other", body, user=_user())

    assert exc_info.value.status_code == 404
    assert fake._tables["meeting_notes"] == []
