import uuid

import pytest
from fastapi import HTTPException

import app.routers.telegram_brain as router_mod
from app.auth.session import SessionPayload


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, table_rows, all_tables, table_name):
        self._rows = list(table_rows)
        self._all_tables = all_tables
        self._table_name = table_name
        self._pending_update = None

    def select(self, *a, **k):
        return self

    def eq(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) == value]
        return self

    def update(self, payload):
        self._pending_update = payload
        return self

    def execute(self):
        if self._pending_update is not None:
            for r in self._rows:
                r.update(self._pending_update)
            # also reflect the update in the underlying table, not just this
            # filtered view, since a later query in the same test re-selects
            # from _all_tables
        return _FakeResult(self._rows)


class _FakeClient:
    def __init__(self, tables: dict):
        self._tables = tables

    def table(self, name):
        return _FakeQuery(self._tables.setdefault(name, []), self._tables, name)


def _user(email="a@x.com", tenant_id="t1", role="sales_agent") -> SessionPayload:
    return SessionPayload(email=email, tenant_id=tenant_id, role=role, exp=9999999999.0)


# ---- get_status ----


def test_get_status_false_when_no_chat_id(monkeypatch):
    fake = _FakeClient({"tenant_users": [{"id": "tu-1", "tenant_id": "t1", "email": "a@x.com", "telegram_chat_id": None}]})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    result = router_mod.get_status(user=_user())

    assert result == {"connected": False}


def test_get_status_true_when_chat_id_present(monkeypatch):
    fake = _FakeClient({"tenant_users": [{"id": "tu-1", "tenant_id": "t1", "email": "a@x.com", "telegram_chat_id": 555}]})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    result = router_mod.get_status(user=_user())

    assert result == {"connected": True}


def test_get_status_404s_for_unknown_user(monkeypatch):
    fake = _FakeClient({"tenant_users": []})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.get_status(user=_user())

    assert exc_info.value.status_code == 404


# ---- create_link_code ----


def test_create_link_code_returns_deep_link_and_stores_code(monkeypatch):
    fake = _FakeClient({"tenant_users": [{"id": "tu-1", "tenant_id": "t1", "email": "a@x.com"}]})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    monkeypatch.setattr(router_mod.secrets, "token_hex", lambda n: "abcd1234")

    result = router_mod.create_link_code(user=_user())

    assert result == {"code": "abcd1234", "deep_link": "https://t.me/Argus_solurabot?start=abcd1234"}
    row = fake._tables["tenant_users"][0]
    assert row["telegram_link_code"] == "abcd1234"


def test_create_link_code_overwrites_previous_unused_code(monkeypatch):
    fake = _FakeClient({"tenant_users": [{"id": "tu-1", "tenant_id": "t1", "email": "a@x.com", "telegram_link_code": "old"}]})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    monkeypatch.setattr(router_mod.secrets, "token_hex", lambda n: "new1234")

    router_mod.create_link_code(user=_user())

    assert fake._tables["tenant_users"][0]["telegram_link_code"] == "new1234"


# ---- send_now ----


def test_send_now_400s_when_not_connected(monkeypatch):
    fake = _FakeClient({"tenant_users": [{"id": "tu-1", "tenant_id": "t1", "email": "a@x.com", "telegram_chat_id": None}]})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.send_now(user=_user())

    assert exc_info.value.status_code == 400


def test_send_now_sends_greeting_built_from_synced_items(monkeypatch):
    fake = _FakeClient({"tenant_users": [{"id": "tu-1", "tenant_id": "t1", "email": "a@x.com", "telegram_chat_id": 555}]})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    monkeypatch.setattr(router_mod, "_sync_and_list", lambda client, tenant_id, role, email: [{"summary": "Позвонить"}])
    monkeypatch.setattr(router_mod, "generate_greeting", lambda items: f"Привет, {len(items)} дел")

    captured = {}

    def fake_send(chat_id, text):
        captured["chat_id"] = chat_id
        captured["text"] = text
        return {"ok": True}

    monkeypatch.setattr(router_mod, "send_bot_message", fake_send)

    result = router_mod.send_now(user=_user())

    assert result == {"ok": True, "text": "Привет, 1 дел"}
    assert captured == {"chat_id": 555, "text": "Привет, 1 дел"}


def test_send_now_503s_when_telegram_send_fails(monkeypatch):
    fake = _FakeClient({"tenant_users": [{"id": "tu-1", "tenant_id": "t1", "email": "a@x.com", "telegram_chat_id": 555}]})
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    monkeypatch.setattr(router_mod, "_sync_and_list", lambda client, tenant_id, role, email: [])
    monkeypatch.setattr(router_mod, "generate_greeting", lambda items: "Всё спокойно")

    def fake_send(chat_id, text):
        raise router_mod.TelegramSendError("boom")

    monkeypatch.setattr(router_mod, "send_bot_message", fake_send)

    with pytest.raises(HTTPException) as exc_info:
        router_mod.send_now(user=_user())

    assert exc_info.value.status_code == 503
