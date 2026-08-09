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
это (например, "Новый клиент, предметных переговоров ещё не было").

telegram_summary -- это резюме переписки, само сгенерированное другой AI-моделью, и оно может
ошибаться. Если здание (например Milano, Roma, Neapol, Venice, Florencia) упоминается в
telegram_summary, но отсутствует в known_buildings -- полностью пропусти этот факт, как будто его не
было во входных данных. НЕ упоминай его даже с оговоркой вида "не подтверждено" или "по данным
переписки" -- просто не пиши о нём вообще, используй только остальную часть telegram_summary и
известные факты из leads/spravka_requests."""

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


def _known_buildings(client_data: dict) -> list[str]:
    """Ground truth for which buildings this client has an actual record
    with -- derived from leads/spravka_requests (real rows, not free text),
    never from telegram_summary itself (an AI-generated field that can
    already be wrong). Caught live (2026-08-10): a handover brief named a
    building the client had zero real leads/справки for, most likely
    inherited from an ungrounded telegram_summary and repeated as fact."""
    names = set()
    for l in client_data.get("leads", []) or []:
        b = (l.get("buildings") or {}).get("name")
        if b:
            names.add(b)
    for s in client_data.get("spravka_requests", []) or []:
        b = ((s.get("units") or {}).get("buildings") or {}).get("name")
        if b:
            names.add(b)
    return sorted(names)


def summarize_client_context(client_data: dict) -> str:
    """client_data: a plain dict of everything known about the client (name,
    phone, leads, spravka_requests, telegram_summary, follow_up_note, ...).
    Returns the summary string.

    No try/except here, same reasoning as the other app/ai single-shot
    callers -- best-effort handling belongs to the caller (the clients
    router)."""
    prompt_data = {**client_data, "known_buildings": _known_buildings(client_data)}
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(prompt_data, ensure_ascii=False)},
    ]
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
        return json.loads(resp.choices[0].message.content)["summary"]
    except Exception:
        logger.exception("Client context summary failed")
        raise
