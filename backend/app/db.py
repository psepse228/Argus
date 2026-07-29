"""Supabase client factory — same pattern as Tender Agent/Cortège."""
import os
from functools import lru_cache

import httpx
from supabase import create_client, Client, ClientOptions


@lru_cache(maxsize=1)
def get_service_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    # This client (and its one pooled httpx connection) lives for the whole
    # process. If a connection sits idle long enough for Supabase's/an
    # intermediate edge's keep-alive timeout to close it server-side, httpx
    # doesn't find out until it tries to reuse it -- surfacing as
    # `httpx.RemoteProtocolError: Server disconnected` on the next request
    # (observed locally after the dev server sat idle between test runs).
    # keepalive_expiry recycles idle connections client-side before that can
    # happen; transport-level retries handles the connection-level failure
    # itself as a fallback (safe here -- it only retries before any request
    # bytes are sent, never after a partial write).
    httpx_client = httpx.Client(
        limits=httpx.Limits(keepalive_expiry=20),
        transport=httpx.HTTPTransport(retries=1),
    )
    return create_client(url, key, options=ClientOptions(httpx_client=httpx_client))
