"""The two AI assistants — items #1 and #2 from the original feature list.
Deliberately sequenced last: these needed the units/leads/spravka data model
solid first, since both are pure function-calling wrappers over it."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.deps import get_current_user, require_boss
from app.ai.chat import run_chat
from app.ai.prompts import BOSS_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT
from app.ai.functions import FUNCTION_SCHEMAS, FUNCTION_SCHEMAS_BOSS_ONLY

router = APIRouter(prefix="/api/assistant")


class ChatRequest(BaseModel):
    message: str
    history: list[dict] | None = None


@router.post("/boss/chat")
def boss_chat(body: ChatRequest, user=Depends(require_boss)):
    reply = run_chat(BOSS_SYSTEM_PROMPT, body.message, user.tenant_id, FUNCTION_SCHEMAS_BOSS_ONLY, body.history, user.email)
    return {"reply": reply}


@router.post("/agent/chat")
def agent_chat(body: ChatRequest, user=Depends(get_current_user)):
    reply = run_chat(AGENT_SYSTEM_PROMPT, body.message, user.tenant_id, FUNCTION_SCHEMAS, body.history, user.email)
    return {"reply": reply}
