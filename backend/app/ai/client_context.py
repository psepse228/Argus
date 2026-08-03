"""GPT-4o structured-output call that solves a real handover problem: when a
sales agent leaves the company, whoever inherits their clients has no idea
what's been discussed or promised -- just raw leads/spravki/messages to dig
through cold. This synthesizes everything known about one client into a
short brief a new manager can read in five seconds. Same single-shot
judgment shape as telegram_evaluator.py/client_segmentation.py, not the
multi-turn function-calling loop in app/ai/chat.py.
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


_SYSTEM_PROMPT = """Ты помогаешь менеджеру по продажам недвижимости быстро войти в курс дела по клиенту,
которого раньше вёл другой менеджер (например, уволившийся). На входе — вся известная история клиента:
лиды (здание, источник, стадия), справки (план оплаты, статус), краткое резюме переписки в Telegram
(если есть) и заметки о звонках.

Дай короткую сводку (2-4 предложения на русском): кто этот клиент, чем интересовался, что уже
обсуждалось/обещали, и что логично сделать дальше. Пиши так, будто новый менеджер прочитает это перед
первым звонком этому клиенту.

Никогда не выдумывай факты, которых нет во входных данных -- если истории почти нет, честно напиши
это (например, "Новый клиент, предметных переговоров ещё не было")."""

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "client_context_summary",
        "schema": {
            "type": "object",
            "properties": {"summary": {"type": "string"}},
            "required": ["summary"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def summarize_client_context(client_data: dict) -> str:
    """client_data: a plain dict of everything known about the client (name,
    phone, leads, spravka_requests, telegram_summary, follow_up_note, ...).
    Returns the summary string.

    No try/except here, same reasoning as the other app/ai single-shot
    callers -- best-effort handling belongs to the caller (the clients
    router)."""
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(client_data, ensure_ascii=False)},
    ]
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
        return json.loads(resp.choices[0].message.content)["summary"]
    except Exception:
        logger.exception("Client context summary failed")
        raise
