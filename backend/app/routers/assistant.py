"""The two AI assistants — items #1 and #2 from the original feature list.
Deliberately sequenced last: these needed the units/leads/spravka data model
solid first, since both are pure function-calling wrappers over it.

Chat history now lives in Postgres (conversations/messages), not in
whatever the frontend happened to hold in React state -- a conversation
survives a refresh, and a user can have more than one. A conversation with
client_id set is that client's own profile-chat (see routers/clients.py),
which gets that client's real history injected into the system prompt so
the assistant's sales advice is grounded, not generic.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user, require_boss
from app.ai.chat import ChatUnavailableError, run_chat
from app.ai.prompts import BOSS_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT, SPRAVKA_MODE_SUFFIX, client_context_prompt
from app.ai.functions import FUNCTION_SCHEMAS, FUNCTION_SCHEMAS_BOSS_ONLY
from app.routers.conversations import touch_conversation

router = APIRouter(prefix="/api/assistant")


class ChatRequest(BaseModel):
    message: str
    conversation_id: str
    mode: str | None = None  # "spravka" when sent via the dedicated chat button


def _load_conversation(client, conversation_id: str, tenant_id: str, user_email: str) -> dict:
    # user_email-scoped too, not just tenant -- otherwise any rep could post
    # into any other rep's (or the boss's) conversation id within the tenant.
    res = (
        client.table("conversations").select("*")
        .eq("id", conversation_id).eq("tenant_id", tenant_id).eq("user_email", user_email)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return res.data[0]


def _load_history(client, conversation_id: str) -> list[dict]:
    rows = client.table("messages").select("role, content").eq("conversation_id", conversation_id).order("created_at").execute().data
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def _persist(client, conversation_id: str, role: str, content: str, events: list | None = None) -> None:
    client.table("messages").insert({
        "conversation_id": conversation_id, "role": role, "content": content, "events": events or None,
    }).execute()
    touch_conversation(client, conversation_id)


def _client_context_suffix(client, tenant_id: str, client_id: str | None) -> str:
    if not client_id:
        return ""
    row = client.table("clients").select("name, phone").eq("id", client_id).eq("tenant_id", tenant_id).execute().data
    if not row:
        return ""
    leads = client.table("leads").select("stage, source").eq("client_id", client_id).execute().data
    spravki = (
        client.table("spravka_requests").select("status, units(unit_number, buildings(name))")
        .eq("client_id", client_id).execute().data
    )
    return client_context_prompt(row[0]["name"], row[0]["phone"], leads, spravki)


@router.post("/boss/chat")
def boss_chat(body: ChatRequest, user=Depends(require_boss)):
    client = get_service_client()
    conv = _load_conversation(client, body.conversation_id, user.tenant_id, user.email)
    prompt = (
        BOSS_SYSTEM_PROMPT
        + (SPRAVKA_MODE_SUFFIX if body.mode == "spravka" else "")
        + _client_context_suffix(client, user.tenant_id, conv.get("client_id"))
    )
    history = _load_history(client, body.conversation_id)
    _persist(client, body.conversation_id, "user", body.message)
    try:
        reply, events = run_chat(prompt, body.message, user.tenant_id, FUNCTION_SCHEMAS_BOSS_ONLY, history, user.email)
    except ChatUnavailableError:
        raise HTTPException(status_code=503, detail="Ассистент временно недоступен — попробуйте через минуту")
    _persist(client, body.conversation_id, "assistant", reply, events)
    return {"reply": reply, "events": events}


@router.post("/agent/chat")
def agent_chat(body: ChatRequest, user=Depends(get_current_user)):
    client = get_service_client()
    conv = _load_conversation(client, body.conversation_id, user.tenant_id, user.email)
    prompt = (
        AGENT_SYSTEM_PROMPT
        + (SPRAVKA_MODE_SUFFIX if body.mode == "spravka" else "")
        + _client_context_suffix(client, user.tenant_id, conv.get("client_id"))
    )
    history = _load_history(client, body.conversation_id)
    _persist(client, body.conversation_id, "user", body.message)
    try:
        reply, events = run_chat(prompt, body.message, user.tenant_id, FUNCTION_SCHEMAS, history, user.email)
    except ChatUnavailableError:
        raise HTTPException(status_code=503, detail="Ассистент временно недоступен — попробуйте через минуту")
    _persist(client, body.conversation_id, "assistant", reply, events)
    return {"reply": reply, "events": events}
