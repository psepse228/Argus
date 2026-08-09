"""Session token forging/tampering resistance -- app/auth/session.py is the
entire authentication mechanism (a signed cookie, no server-side session
store), so a gap here is a full account-takeover-shaped bug. Previously
untested.
"""
import time

from app.auth.session import SessionPayload, create_session_token, verify_session_token

SECRET = "test-secret-do-not-use-in-prod"


def _valid_token() -> str:
    payload = SessionPayload(email="a@x.com", tenant_id="t1", role="sales_agent", exp=time.time() + 3600)
    return create_session_token(payload, SECRET)


def test_roundtrip_produces_the_original_payload():
    token = _valid_token()
    result = verify_session_token(token, SECRET)
    assert result is not None
    assert result.email == "a@x.com"
    assert result.tenant_id == "t1"
    assert result.role == "sales_agent"


def test_wrong_secret_is_rejected():
    token = _valid_token()
    assert verify_session_token(token, "a-completely-different-secret") is None


def test_tampered_payload_is_rejected():
    """Flip the role in the payload without re-signing -- a forged
    privilege-escalation attempt (sales_agent claiming to be boss)."""
    token = _valid_token()
    encoded, signature = token.split(".")
    import base64
    import json

    def b64url_decode(s):
        pad = "=" * (-len(s) % 4)
        return base64.urlsafe_b64decode(s + pad)

    def b64url_encode(data):
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    raw = json.loads(b64url_decode(encoded))
    raw["role"] = "boss"
    forged_encoded = b64url_encode(json.dumps(raw).encode())
    forged_token = f"{forged_encoded}.{signature}"  # old signature, new (tampered) body

    assert verify_session_token(forged_token, SECRET) is None


def test_expired_token_is_rejected():
    payload = SessionPayload(email="a@x.com", tenant_id="t1", role="sales_agent", exp=time.time() - 10)
    token = create_session_token(payload, SECRET)

    assert verify_session_token(token, SECRET) is None


def test_malformed_token_missing_dot_is_rejected():
    assert verify_session_token("not-a-real-token", SECRET) is None


def test_malformed_token_extra_dot_is_rejected():
    token = _valid_token()
    assert verify_session_token(token + ".extra", SECRET) is None


def test_empty_token_is_rejected():
    assert verify_session_token("", SECRET) is None


def test_garbage_base64_is_rejected():
    assert verify_session_token("not-valid-base64!!!.abcd1234", SECRET) is None
