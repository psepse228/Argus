"""Auth dependency. Deliberately a plain `def`, not `async def` — it does a
synchronous cookie-verify (cheap) and, on the /api/auth/me path only, is used
without any Supabase call at all, matching Cortège's "per-request path stays
a pure synchronous cookie-verify with zero DB calls" design. See
concepts/fastapi-async-blocking-io in the wiki for why `async def` here would
be actively wrong once anything blocking gets added to this function later.
"""
import os
from fastapi import Request, HTTPException, Depends

from app.auth.session import verify_session_token
from app.routers.auth_google import SESSION_COOKIE_NAME


def get_current_user(request: Request):
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    secret = os.environ.get("SESSION_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="Server misconfigured")
    payload = verify_session_token(token, secret)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return payload


def require_boss(user=Depends(get_current_user)):
    if user.role != "boss":
        raise HTTPException(status_code=403, detail="Boss role required")
    return user
