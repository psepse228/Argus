"""Мастерская -- the set of client profiles a rep has chosen to actively
work on, replacing the old standalone Справки tab (creation moved into each
client's own workspace, see ClientWorkspace.tsx on the frontend). Per-user:
each rep curates their own working set independently.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/workspace")


@router.get("")
def list_workspace(user=Depends(get_current_user)):
    client = get_service_client()
    pins = (
        client.table("workspace_clients").select("client_id, added_at")
        .eq("tenant_id", user.tenant_id).eq("user_email", user.email)
        .order("added_at", desc=True).execute().data
    )
    if not pins:
        return []
    client_ids = [p["client_id"] for p in pins]
    clients = client.table("clients").select("*").in_("id", client_ids).execute().data
    by_id = {c["id"]: c for c in clients}
    # Preserve pin order (most recently added first), skip any client since deleted.
    return [by_id[p["client_id"]] for p in pins if p["client_id"] in by_id]


@router.post("/{client_id}")
def pin_client(client_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    owns = client.table("clients").select("id").eq("id", client_id).eq("tenant_id", user.tenant_id).execute()
    if not owns.data:
        raise HTTPException(status_code=404, detail="Client not found")
    client.table("workspace_clients").upsert(
        {"tenant_id": user.tenant_id, "client_id": client_id, "user_email": user.email},
        on_conflict="tenant_id,client_id,user_email",
    ).execute()
    return {"ok": True}


@router.delete("/{client_id}")
def unpin_client(client_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    client.table("workspace_clients").delete().eq("tenant_id", user.tenant_id).eq("client_id", client_id).eq("user_email", user.email).execute()
    return {"ok": True}
