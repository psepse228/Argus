"""Shared GPT-4o function-calling loop for both assistants. Plain `def`, not
`async def` — the OpenAI call and the function calls it triggers are both
blocking, so this stays on FastAPI's threadpool path (see
concepts/fastapi-async-blocking-io).
"""
import os
import json
from openai import OpenAI

from app.ai.functions import call_function

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


def run_chat(system_prompt: str, user_message: str, tenant_id: str, schemas: list[dict],
             history: list[dict] | None = None) -> str:
    client = _get_client()
    messages = [{"role": "system", "content": system_prompt}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    # up to 4 rounds of tool calls before forcing a final answer
    for _ in range(4):
        resp = client.chat.completions.create(
            model="gpt-4o", messages=messages, tools=schemas, tool_choice="auto",
        )
        choice = resp.choices[0]
        messages.append(choice.message.model_dump(exclude_none=True))

        if not choice.message.tool_calls:
            return choice.message.content or ""

        for tool_call in choice.message.tool_calls:
            args = json.loads(tool_call.function.arguments or "{}")
            try:
                result = call_function(tool_call.function.name, args, tenant_id)
            except Exception as e:
                result = {"error": str(e)}
            messages.append({
                "role": "tool", "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })

    # ran out of tool-call rounds — force a final plain answer
    final = client.chat.completions.create(model="gpt-4o", messages=messages)
    return final.choices[0].message.content or ""
