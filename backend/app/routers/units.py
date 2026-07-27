"""Units API — both roles can read; only bosses can write status changes
directly (sales agents go through spravka_requests for anything price/status
related, per the owner's explicit veto on silent automated changes)."""
from fastapi import APIRouter, Depends, HTTPException

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/units")


@router.get("")
def list_units(building: str | None = None, user=Depends(get_current_user)):
    """Plain `def` — this does a blocking Supabase call; keeping it sync lets
    FastAPI threadpool-dispatch it automatically (see
    concepts/fastapi-async-blocking-io in the wiki)."""
    client = get_service_client()
    # Joins the building name in -- the frontend's building filter/chess-grid
    # both key off u.buildings.name, which a bare select("*") never returns.
    q = client.table("units").select("*, buildings(name)").eq("tenant_id", user.tenant_id)
    if building:
        q = q.eq("building_id", building)
    res = q.execute()
    return res.data


@router.get("/{unit_id}/interest")
def unit_interest(unit_id: str, user=Depends(get_current_user)):
    """The reverse of the Клиенты workspace: instead of "which apartments
    does this client want", this is "which clients want this apartment" --
    a real справка made for this exact unit (concrete interest), plus any
    lead whose building matches but hasn't gone as far as a справка yet
    (soft interest), same two-tier idea as ClientsPanel's "Квартиры" list."""
    client = get_service_client()
    unit_res = client.table("units").select("building_id").eq("id", unit_id).eq("tenant_id", user.tenant_id).execute()
    if not unit_res.data:
        raise HTTPException(status_code=404, detail="Unit not found")
    building_id = unit_res.data[0]["building_id"]

    spravki = (
        client.table("spravka_requests")
        .select("id, client_id, client_name, client_phone, plan_type, status, created_at")
        .eq("unit_id", unit_id).eq("tenant_id", user.tenant_id).order("created_at", desc=True).execute().data
    )
    spravka_client_ids = {s["client_id"] for s in spravki if s.get("client_id")}

    leads = (
        client.table("leads")
        .select("id, client_id, phone, stage, source, created_at")
        .eq("building_id", building_id).eq("tenant_id", user.tenant_id).order("created_at", desc=True).execute().data
    )
    soft_leads = [l for l in leads if l.get("client_id") not in spravka_client_ids]

    return {"spravka_requests": spravki, "soft_leads": soft_leads}


@router.get("/buildings")
def list_buildings(user=Depends(get_current_user)):
    client = get_service_client()
    res = client.table("buildings").select("*").eq("tenant_id", user.tenant_id).execute()
    return res.data
