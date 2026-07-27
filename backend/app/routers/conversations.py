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
        .is_("client_id", "null")
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
    on the same running thread instead of spawning a new one each time."""
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
    row = client.table("conversations").insert({
        "tenant_id": user.tenant_id, "user_email": user.email, "client_id": client_id,
    }).execute().data[0]
    return row


def touch_conversation(client, conversation_id: str) -> None:
    client.table("conversations").update({
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation_id).execute()
