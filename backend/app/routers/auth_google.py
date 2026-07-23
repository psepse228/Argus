"""Google OAuth login — same shape as Cortège's session.ts flow and Tender
Agent's app/routers/auth_google.py, adapted for role-aware, non-self-serve
tenant_users lookup (see app/auth/tenant.py for why no auto-create here).
"""
import os
import time
import urllib.parse

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse, JSONResponse

from app.auth.session import SessionPayload, create_session_token
from app.auth.tenant import find_tenant_user_by_email

router = APIRouter(prefix="/api/auth/google")

SESSION_COOKIE_NAME = "argus_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days


def _dev_bypass_response(email: str) -> RedirectResponse:
    user = find_tenant_user_by_email(email)
    if not user:
        return RedirectResponse(url="/login?error=no_account")
    return _issue_session_redirect(user.email, user.tenant_id, user.role)


def _issue_session_redirect(email: str, tenant_id: str, role: str) -> RedirectResponse:
    token = create_session_token(
        SessionPayload(email=email, tenant_id=tenant_id, role=role, exp=time.time() + SESSION_MAX_AGE_SECONDS),
        os.environ["SESSION_SECRET"],
    )
    # Redirect to the actual frontend app (a separate origin/server), not a
    # same-origin path on this API — leftover from before the frontend existed.
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    resp = RedirectResponse(url=f"{frontend_url}/app")
    resp.set_cookie(
        SESSION_COOKIE_NAME, token, max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True, samesite="lax", secure=os.environ.get("ENVIRONMENT") == "production",
    )
    return resp


@router.get("/start")
def google_start(request: Request):
    """Local dev only: DEV_BYPASS_EMAIL skips the whole Google round-trip.
    Gated on ENVIRONMENT != "production" as a second, independent check —
    same reasoning as Tender Agent/Cortège: relying on "just don't set this
    var in prod" alone means one misplaced env var becomes a full auth
    bypass for whichever account it maps to."""
    bypass_email = os.environ.get("DEV_BYPASS_EMAIL")
    if bypass_email and os.environ.get("ENVIRONMENT") != "production":
        return _dev_bypass_response(bypass_email)

    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    redirect_uri = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI")
    if not client_id or not redirect_uri:
        return JSONResponse({"error": "Google OAuth is not configured on the server"}, status_code=500)

    params = {
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
        "scope": "openid email profile", "access_type": "online", "prompt": "select_account",
    }
    return RedirectResponse(url="https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params))


@router.get("/callback")
def google_callback(request: Request, code: str = ""):
    if not code:
        return RedirectResponse(url="/login?error=missing_code")

    client_id = os.environ["GOOGLE_OAUTH_CLIENT_ID"]
    client_secret = os.environ["GOOGLE_OAUTH_CLIENT_SECRET"]
    redirect_uri = os.environ["GOOGLE_OAUTH_REDIRECT_URI"]

    token_resp = httpx.post("https://oauth2.googleapis.com/token", data={
        "code": code, "client_id": client_id, "client_secret": client_secret,
        "redirect_uri": redirect_uri, "grant_type": "authorization_code",
    })
    if token_resp.status_code != 200:
        return RedirectResponse(url="/login?error=google_token_exchange_failed")
    access_token = token_resp.json()["access_token"]

    profile_resp = httpx.get(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if profile_resp.status_code != 200:
        return RedirectResponse(url="/login?error=google_profile_failed")
    email = profile_resp.json().get("email")
    if not email:
        return RedirectResponse(url="/login?error=no_email")

    user = find_tenant_user_by_email(email)
    if not user:
        # Deliberately not auto-creating — see app/auth/tenant.py.
        return RedirectResponse(url="/login?error=no_account")

    return _issue_session_redirect(user.email, user.tenant_id, user.role)


@router.post("/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE_NAME)
    return resp


# Separate router (no /google sub-prefix) for the /api/auth/me identity check —
# a router's `prefix` is a literal string concat, not a path-aware join, so this
# can't just be tacked onto `router` above with a "../me" route.
me_router = APIRouter(prefix="/api/auth")


@me_router.get("/me")
def me(request: Request):
    from app.deps import get_current_user
    user = get_current_user(request)
    return {"email": user.email, "role": user.role, "tenant_id": user.tenant_id}
