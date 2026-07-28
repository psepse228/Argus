"""GPT-4o structured-output call that turns a Telegram thread into what a
manager needs to act on it: a summary, a next-step suggestion, and a draft
reply. One call, not the multi-turn function-calling loop in app/ai/chat.py
-- that's for the rep-facing assistant chat, this is a single-shot judgment
on a client-facing thread, a different domain entirely.
"""
import json
import logging
import os

from openai import OpenAI

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


_SYSTEM_PROMPT = """Ты помогаешь агенту по недвижимости разобрать переписку с клиентом в Telegram.
По всей истории переписки дай: краткое резюме (2-3 предложения — о чём был разговор и что хочет
клиент), подсказку следующего шага (что агенту стоит сделать дальше), и черновик ответа клиенту на
его последнее сообщение (вежливый, по делу). Никогда не выдумывай цены, юниты или условия — если
клиент спросил о чём-то конкретном, чего нет в истории переписки, в черновике предложи агенту
уточнить это лично, а не придумывай цифры."""

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "telegram_evaluation",
        "schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "next_step": {"type": "string"},
                "draft_reply": {"type": "string"},
            },
            "required": ["summary", "next_step", "draft_reply"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def evaluate_conversation(history: list[dict]) -> dict:
    """history: [{"role": "client"|"manager", "content": str}, ...], oldest
    message first. Returns {"summary": str, "next_step": str, "draft_reply": str}.

    This function makes no attempt to catch or wrap errors itself -- any
    OpenAI API failure or malformed-response JSON error is logged and then
    re-raised as-is. The caller (the Telegram webhook router) is expected to
    treat this as best-effort and handle failures broadly; unlike
    app/ai/chat.py's ChatUnavailableError, there's no dedicated exception
    type here because nothing downstream needs to branch on one."""
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for turn in history:
        messages.append({
            "role": "user" if turn["role"] == "client" else "assistant",
            "content": turn["content"],
        })
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
        return json.loads(resp.choices[0].message.content)
    except Exception:
        logger.exception("Telegram conversation evaluation failed")
        raise
