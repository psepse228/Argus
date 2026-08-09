"""Covers only the /start <code> personal-chat linking block added to the
webhook for proactive Argus Brain (2026-08-08) -- the pre-existing business-
connection relay logic above/below it already has its own coverage plan
tracked separately and isn't touched here.
"""
import pytest
from fastapi import HTTPException

import app.routers.telegram_business as router_mod


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
        return _FakeResult(self._rows)


class _FakeClient:
    def __init__(self, tables: dict):
        self._tables = tables

    def table(self, name):
        return _FakeQuery(self._tables.setdefault(name, []), self._tables, name)


class _FakeRequest:
    def __init__(self, headers: dict):
        self.headers = headers


def _setup(monkeypatch, tables, send_ok=True):
    fake = _FakeClient(tables)
    monkeypatch.setattr(router_mod, "get_service_client", lambda: fake)
    monkeypatch.setattr(router_mod, "verify_webhook_signature", lambda secret: True)
    sent = []

    def fake_send(chat_id, text):
        sent.append((chat_id, text))
        if not send_ok:
            raise router_mod.TelegramSendError("boom")
        return {"ok": True}

    monkeypatch.setattr(router_mod, "send_bot_message", fake_send)
    return fake, sent


def test_start_with_valid_code_links_chat_and_confirms(monkeypatch):
    fake, sent = _setup(monkeypatch, {
        "tenant_users": [{"id": "tu-1", "telegram_link_code": "abcd1234", "telegram_chat_id": None}],
    })
    update = {"message": {"text": "/start abcd1234", "chat": {"id": 777}}}

    result = router_mod.telegram_business_webhook(update, _FakeRequest({}))

    assert result == {"ok": True}
    row = fake._tables["tenant_users"][0]
    assert row["telegram_chat_id"] == 777
    assert row["telegram_link_code"] is None
    assert sent == [(777, "Готово — Argus Brain теперь может писать вам сюда.")]


def test_start_with_unknown_code_does_nothing(monkeypatch):
    fake, sent = _setup(monkeypatch, {
        "tenant_users": [{"id": "tu-1", "telegram_link_code": "real-code", "telegram_chat_id": None}],
    })
    update = {"message": {"text": "/start wrong-code", "chat": {"id": 777}}}

    result = router_mod.telegram_business_webhook(update, _FakeRequest({}))

    assert result == {"ok": True}
    row = fake._tables["tenant_users"][0]
    assert row["telegram_chat_id"] is None
    assert row["telegram_link_code"] == "real-code"
    assert sent == []


def test_start_with_no_code_is_a_noop(monkeypatch):
    fake, sent = _setup(monkeypatch, {
        "tenant_users": [{"id": "tu-1", "telegram_link_code": "real-code", "telegram_chat_id": None}],
    })
    update = {"message": {"text": "/start", "chat": {"id": 777}}}

    result = router_mod.telegram_business_webhook(update, _FakeRequest({}))

    assert result == {"ok": True}
    assert fake._tables["tenant_users"][0]["telegram_link_code"] == "real-code"
    assert sent == []


def test_start_link_succeeds_even_if_confirmation_send_fails(monkeypatch):
    """The confirmation message is best-effort -- the link itself must not
    be undone just because Telegram's send call happened to fail."""
    fake, sent = _setup(monkeypatch, {
        "tenant_users": [{"id": "tu-1", "telegram_link_code": "abcd1234", "telegram_chat_id": None}],
    }, send_ok=False)
    update = {"message": {"text": "/start abcd1234", "chat": {"id": 777}}}

    result = router_mod.telegram_business_webhook(update, _FakeRequest({}))

    assert result == {"ok": True}
    row = fake._tables["tenant_users"][0]
    assert row["telegram_chat_id"] == 777
    assert row["telegram_link_code"] is None


def test_webhook_401s_on_wrong_secret_using_the_real_verifier(monkeypatch):
    """Uses the real verify_webhook_signature (not mocked) -- an attacker
    who doesn't know TELEGRAM_WEBHOOK_SECRET must never reach the linking
    or relay logic below it, regardless of what's in the update body."""
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "the-real-secret")
    # get_service_client must never even be called -- rejection has to happen
    # before touching the DB at all.
    monkeypatch.setattr(router_mod, "get_service_client", lambda: (_ for _ in ()).throw(AssertionError("should not reach the DB")))
    update = {"message": {"text": "/start abcd1234", "chat": {"id": 777}}}

    with pytest.raises(HTTPException) as exc_info:
        router_mod.telegram_business_webhook(update, _FakeRequest({"x-telegram-bot-api-secret-token": "wrong-secret"}))

    assert exc_info.value.status_code == 401


def test_non_start_direct_message_falls_through_without_crashing(monkeypatch):
    fake, sent = _setup(monkeypatch, {"tenant_users": []})
    update = {"message": {"text": "hello bot", "chat": {"id": 777}}}

    result = router_mod.telegram_business_webhook(update, _FakeRequest({}))

    assert result == {"ok": True}
    assert sent == []
