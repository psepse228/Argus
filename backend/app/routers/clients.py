"""Client profile — before this, a "client" was just free-text (name, phone)
duplicated independently across leads and spravka_requests, with no single
place to see one person's whole history. Each client also gets their own
profile-chat conversation (see routers/conversations.py) where a rep's
entire back-and-forth about that person, plus their real Справки, live
together.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/clients")


@router.get("")
def list_clients(user=Depends(get_current_user)):
    client = get_service_client()
    clients = (
        client.table("clients").select("*").eq("tenant_id", user.tenant_id)
        .order("created_at", desc=True).execute().data
    )
    leads = client.table("leads").select("client_id").eq("tenant_id", user.tenant_id).execute().data
    spravki = client.table("spravka_requests").select("client_id, status").eq("tenant_id", user.tenant_id).execute().data

    lead_counts: dict[str, int] = {}
    for l in leads:
        if l.get("client_id"):
            lead_counts[l["client_id"]] = lead_counts.get(l["client_id"], 0) + 1
    spravka_counts: dict[str, int] = {}
    for s in spravki:
        if s.get("client_id"):
            spravka_counts[s["client_id"]] = spravka_counts.get(s["client_id"], 0) + 1

    return [{
        **c,
        "leads_count": lead_counts.get(c["id"], 0),
        "spravka_count": spravka_counts.get(c["id"], 0),
    } for c in clients]


@router.get("/{client_id}")
def get_client(client_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    res = client.table("clients").select("*").eq("id", client_id).eq("tenant_id", user.tenant_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Client not found")
    leads = (
        client.table("leads").select("*, buildings(name)")
        .eq("client_id", client_id).order("created_at", desc=True).execute().data
    )
    spravki = (
        client.table("spravka_requests")
        .select("*, units(unit_number, floor, area_m2, buildings(name))")
        .eq("client_id", client_id).order("created_at", desc=True).execute().data
    )
    # Deal timeline needs this client's payment rows too, but payment_schedule
    # only links back through spravka_request_id (no client_id column of its
    # own) -- fetch by the spravka ids just resolved above.
    spravka_ids = [s["id"] for s in spravki]
    payments = (
        client.table("payment_schedule")
        .select("id, spravka_request_id, installment_number, label, due_date, amount_usd, status, paid_at")
        .in_("spravka_request_id", spravka_ids).eq("tenant_id", user.tenant_id).order("due_date").execute().data
        if spravka_ids else []
    )
    return {**res.data[0], "leads": leads, "spravka_requests": spravki, "payments": payments}
