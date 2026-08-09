"""Shared GPT-4o function-calling loop for both assistants. Plain `def`, not
`async def` — the OpenAI call and the function calls it triggers are both
blocking, so this stays on FastAPI's threadpool path (see
concepts/fastapi-async-blocking-io).
"""
import logging
import os
import json
from openai import APIError, OpenAI

from app.ai.functions import call_function

logger = logging.getLogger(__name__)

_client = None


class ChatUnavailableError(Exception):
    """Raised when the OpenAI API itself fails (quota, rate limit, outage) --
    distinct from a function-call failure, which is fed back to the model as
    a tool result instead of aborting the conversation. Routers translate
    this into a clean HTTP error instead of a raw 500 with a stack trace
    reaching the frontend."""


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


def _complete(client: OpenAI, **kwargs):
    try:
        return client.chat.completions.create(**kwargs)
    except APIError as e:
        logger.exception("OpenAI API call failed")
        raise ChatUnavailableError(str(e)) from e


def run_chat(system_prompt: str, user_message: str, tenant_id: str, schemas: list[dict],
             history: list[dict] | None = None, requester_email: str | None = None) -> tuple[str, list[dict]]:
    """Returns (reply_text, events). `events` surfaces structured, UI-renderable
    facts about what the tool calls actually did in this turn: a "tool_call"
    entry per function call (so the frontend can render the real step trace
    instead of a black box), "spravka_created" for the existing inline-card
    case, and one trailing "confidence" entry.

    That confidence is a heuristic, not a real model-reported score (GPT-4o
    function-calling doesn't expose one here) -- "high" means every tool call
    this turn succeeded and the model answered on its own within the round
    budget; "medium" means at least one tool call failed; "low" means the
    conversation ran out of tool-call rounds and had to be forced to a final
    answer, i.e. the model was still trying to figure something out."""
    client = _get_client()
    messages = [{"role": "system", "content": system_prompt}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_message})
    events: list[dict] = []
    had_error = False

    # up to 4 rounds of tool calls before forcing a final answer
    for _ in range(4):
        resp = _complete(client, model="gpt-4o", messages=messages, tools=schemas, tool_choice="auto")
        choice = resp.choices[0]
        messages.append(choice.message.model_dump(exclude_none=True))

        if not choice.message.tool_calls:
            events.append({"type": "confidence", "level": "medium" if had_error else "high"})
            return choice.message.content or "", events

        for tool_call in choice.message.tool_calls:
            args = json.loads(tool_call.function.arguments or "{}")
            try:
                result = call_function(tool_call.function.name, args, tenant_id, requester_email)
            except Exception as e:
                result = {"error": str(e)}
            # Not every tool returns a dict -- get_units/get_pending_approvals/
            # get_payment_plan_rates return a plain list (real bug found live,
            # 2026-08-10: `result.get("error")` on a list crashed the whole
            # request with a 500, so a chat message that triggered any of
            # those three tools always failed silently from the user's side).
            result_is_dict = isinstance(result, dict)
            ok = not (result_is_dict and result.get("error"))
            had_error = had_error or not ok
            events.append({"type": "tool_call", "name": tool_call.function.name, "ok": ok})
            if tool_call.function.name == "create_spravka_request" and result_is_dict and result.get("ok"):
                events.append({"type": "spravka_created", **result})
            messages.append({
                "role": "tool", "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })

    # ran out of tool-call rounds — force a final plain answer
    final = _complete(client, model="gpt-4o", messages=messages)
    events.append({"type": "confidence", "level": "low"})
    return final.choices[0].message.content or "", events
