import time

import pytest
from fastapi import HTTPException

from app.auth.session import SessionPayload, create_session_token
from app.deps import get_current_user, require_boss
from app.routers.auth_google import SESSION_COOKIE_NAME


def _user(role: str) -> SessionPayload:
    return SessionPayload(email="a@x.com", tenant_id="t1", role=role, exp=9999999999.0)


def test_require_boss_rejects_sales_agent():
    with pytest.raises(HTTPException) as exc_info:
        require_boss(user=_user("sales_agent"))
    assert exc_info.value.status_code == 403


def test_require_boss_allows_boss():
    result = require_boss(user=_user("boss"))
    assert result.role == "boss"


class _FakeRequest:
    def __init__(self, cookies: dict):
        self.cookies = cookies


def test_get_current_user_401s_with_no_cookie(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    with pytest.raises(HTTPException) as exc_info:
        get_current_user(_FakeRequest({}))
    assert exc_info.value.status_code == 401


def test_get_current_user_401s_with_garbage_cookie(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    with pytest.raises(HTTPException) as exc_info:
        get_current_user(_FakeRequest({SESSION_COOKIE_NAME: "garbage.value"}))
    assert exc_info.value.status_code == 401


def test_get_current_user_500s_when_session_secret_unset(monkeypatch):
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    with pytest.raises(HTTPException) as exc_info:
        get_current_user(_FakeRequest({SESSION_COOKIE_NAME: "anything.anything"}))
    assert exc_info.value.status_code == 500


def test_get_current_user_succeeds_with_a_valid_cookie(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    token = create_session_token(
        SessionPayload(email="a@x.com", tenant_id="t1", role="boss", exp=time.time() + 3600),
        "s3cr3t",
    )
    result = get_current_user(_FakeRequest({SESSION_COOKIE_NAME: token}))
    assert result.email == "a@x.com"
    assert result.role == "boss"


def test_get_current_user_401s_for_a_token_signed_with_a_different_secret(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    token = create_session_token(
        SessionPayload(email="a@x.com", tenant_id="t1", role="boss", exp=time.time() + 3600),
        "a-different-secret-entirely",
    )
    with pytest.raises(HTTPException) as exc_info:
        get_current_user(_FakeRequest({SESSION_COOKIE_NAME: token}))
    assert exc_info.value.status_code == 401
