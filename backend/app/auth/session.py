"""Signed session tokens — direct port of Cortège's session.ts, same format:
base64url(JSON payload) + "." + hex(HMAC_SHA256(payload, SESSION_SECRET)).

Adds a `role` field ("boss" | "sales_agent") to the payload, which neither
Cortège nor Tender Agent's session needed — Argus is the first Solura product
with more than one role per tenant.
"""
import base64
import hashlib
import hmac as hmac_lib
import json
import time
from dataclasses import dataclass
from typing import Optional


@dataclass
class SessionPayload:
    email: str
    tenant_id: str
    role: str
    exp: float


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(encoded_payload: str, secret: str) -> str:
    return hmac_lib.new(secret.encode(), encoded_payload.encode(), hashlib.sha256).hexdigest()


def create_session_token(payload: SessionPayload, secret: str) -> str:
    body = json.dumps({
        "email": payload.email, "tenantId": payload.tenant_id,
        "role": payload.role, "exp": payload.exp,
    }).encode()
    encoded = _b64url_encode(body)
    return f"{encoded}.{_sign(encoded, secret)}"


def verify_session_token(token: str, secret: str) -> Optional[SessionPayload]:
    parts = token.split(".")
    if len(parts) != 2:
        return None
    encoded, signature = parts
    expected = _sign(encoded, secret)
    if not hmac_lib.compare_digest(signature, expected):
        return None
    try:
        raw = json.loads(_b64url_decode(encoded))
        exp = raw["exp"]
        if not isinstance(exp, (int, float)) or exp < time.time():
            return None
        return SessionPayload(
            email=raw["email"], tenant_id=raw["tenantId"],
            role=raw["role"], exp=exp,
        )
    except Exception:
        return None
