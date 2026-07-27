"""Units API — both roles can read; only bosses can write status changes
directly (sales agents go through spravka_requests for anything price/status
related, per the owner's explicit veto on silent automated changes)."""
from fastapi import APIRouter, Depends

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


@router.get("/buildings")
def list_buildings(user=Depends(get_current_user)):
    client = get_service_client()
    res = client.table("buildings").select("*").eq("tenant_id", user.tenant_id).execute()
    return res.data
