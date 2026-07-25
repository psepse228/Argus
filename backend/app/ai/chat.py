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
             history: list[dict] | None = None, requester_email: str | None = None) -> str:
    client = _get_client()
    messages = [{"role": "system", "content": system_prompt}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    # up to 4 rounds of tool calls before forcing a final answer
    for _ in range(4):
        resp = _complete(client, model="gpt-4o", messages=messages, tools=schemas, tool_choice="auto")
        choice = resp.choices[0]
        messages.append(choice.message.model_dump(exclude_none=True))

        if not choice.message.tool_calls:
            return choice.message.content or ""

        for tool_call in choice.message.tool_calls:
            args = json.loads(tool_call.function.arguments or "{}")
            try:
                result = call_function(tool_call.function.name, args, tenant_id, requester_email)
            except Exception as e:
                result = {"error": str(e)}
            messages.append({
                "role": "tool", "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })

    # ran out of tool-call rounds — force a final plain answer
    final = _complete(client, model="gpt-4o", messages=messages)
    return final.choices[0].message.content or ""
