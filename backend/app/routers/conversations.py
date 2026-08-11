"""Persisted assistant conversations — replaces the old chat, which lived
only in the frontend's React state (gone on refresh, only ever one thread).
A conversation with client_id set is that client's own profile-chat
(routers/clients.py); client_id null is a general assistant chat, of which a
user can have several, listed and switchable like any real chat app.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/conversations")


@router.get("")
def list_conversations(user=Depends(get_current_user)):
    client = get_service_client()
    res = (
        client.table("conversations").select("*")
        .eq("tenant_id", user.tenant_id).eq("user_email", user.email)
        .is_("client_id", "null").eq("purpose", "chat")
        .order("updated_at", desc=True)
        .execute()
    )
    return res.data


class ConversationCreate(BaseModel):
    title: str | None = None


@router.post("")
def create_conversation(body: ConversationCreate, user=Depends(get_current_user)):
    client = get_service_client()
    row = client.table("conversations").insert({
        "tenant_id": user.tenant_id, "user_email": user.email, "title": body.title,
    }).execute().data[0]
    return row


@router.delete("/{conversation_id}")
def delete_conversation(conversation_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    res = (
        client.table("conversations").delete()
        .eq("id", conversation_id).eq("tenant_id", user.tenant_id).eq("user_email", user.email)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@router.get("/{conversation_id}/messages")
def get_messages(conversation_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    conv = (
        client.table("conversations").select("id")
        .eq("id", conversation_id).eq("tenant_id", user.tenant_id).eq("user_email", user.email)
        .execute()
    )
    if not conv.data:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return client.table("messages").select("*").eq("conversation_id", conversation_id).order("created_at").execute().data


@router.post("/client/{client_id}")
def get_or_create_client_conversation(client_id: str, user=Depends(get_current_user)):
    """A client's profile-chat is 1:1 per (rep, client) -- get the existing
    one or create it, so clicking into a client from Клиенты always lands
    on the same running thread instead of spawning a new one each time.

    Real bug found live (2026-08-10): this select-then-insert used to have
    no DB-level guard, so two near-simultaneous requests (two components
    mounting at once, a fast re-render, two tabs) could both see "none
    found" and both insert -- two competing threads for the same (rep,
    client), and whichever one a later page load happened to pick back up
    looked like a different, incomplete history each time. migration 0036
    adds a partial unique index on (tenant_id, user_email, client_id); the
    insert here now expects a possible conflict and re-selects instead of
    trusting its own insert blindly."""
    client = get_service_client()
    owned = client.table("clients").select("id").eq("id", client_id).eq("tenant_id", user.tenant_id).execute()
    if not owned.data:
        raise HTTPException(status_code=404, detail="Client not found")
    existing = (
        client.table("conversations").select("*")
        .eq("tenant_id", user.tenant_id).eq("user_email", user.email).eq("client_id", client_id)
        .execute()
    )
    if existing.data:
        return existing.data[0]
    try:
        return client.table("conversations").insert({
            "tenant_id": user.tenant_id, "user_email": user.email, "client_id": client_id,
        }).execute().data[0]
    except Exception:
        # Lost the race -- a concurrent request already inserted between our
        # SELECT and this INSERT. The unique index rejected ours; the real
        # row is the other one, so re-select instead of erroring.
        return (
            client.table("conversations").select("*")
            .eq("tenant_id", user.tenant_id).eq("user_email", user.email).eq("client_id", client_id)
            .execute().data[0]
        )


@router.post("/help")
def get_or_create_help_conversation(user=Depends(get_current_user)):
    """The help chatbot has exactly one running thread per user -- same
    get-existing-or-create-with-race-fallback shape as
    get_or_create_client_conversation above, keyed on purpose='help'
    instead of client_id (see migration 0036 for the matching unique index)."""
    client = get_service_client()
    existing = (
        client.table("conversations").select("*")
        .eq("tenant_id", user.tenant_id).eq("user_email", user.email).eq("purpose", "help")
        .execute()
    )
    if existing.data:
        return existing.data[0]
    try:
        return client.table("conversations").insert({
            "tenant_id": user.tenant_id, "user_email": user.email, "purpose": "help",
        }).execute().data[0]
    except Exception:
        return (
            client.table("conversations").select("*")
            .eq("tenant_id", user.tenant_id).eq("user_email", user.email).eq("purpose", "help")
            .execute().data[0]
        )


def touch_conversation(client, conversation_id: str) -> None:
    client.table("conversations").update({
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation_id).execute()
