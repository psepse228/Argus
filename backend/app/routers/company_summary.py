"""Argus Brain Phase 3: the boss's on-demand "Сводка" AI narrative. Unlike
Phase 2b's daily briefing, this is deliberately NOT cached -- one boss,
low click volume, debounced client-side against rapid re-clicks (see
docs/superpowers/specs/2026-08-05-argus-brain-design.md, "Owner live
summary"). Every POST here is a real OpenAI call.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.ai.brain import gather_company_context
from app.ai.company_summary import generate_company_summary
from app.db import get_service_client
from app.deps import require_boss

router = APIRouter(prefix="/api/brain")


@router.post("/company-summary")
def company_summary(user=Depends(require_boss)):
    client = get_service_client()
    facts = gather_company_context(client, user.tenant_id)
    try:
        return generate_company_summary(facts)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось построить сводку — попробуйте ещё раз")
