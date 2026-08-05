"""Single-shot GPT-4o call that turns gather_manager_context's deterministic
facts (backend/app/ai/brain.py) into a prioritized, phrased task list for one
manager's "На сегодня" -- the part of Argus Brain that actually directs the
sales team, not just informs it. Same discipline as telegram_evaluator.py/
client_context.py: never invent a fact that isn't in the input; the model's
job is to rank, phrase, and add judgment calls grounded in what's actually
there (e.g. "this lead looks ready but hasn't been contacted in 2 days"),
not to hallucinate a lead/event/справка that doesn't exist.
"""
import json
import logging
import os
from datetime import datetime, timezone

from openai import OpenAI

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


_SYSTEM_PROMPT = """Ты помогаешь менеджеру по продажам недвижимости понять, что делать сегодня.
На входе -- JSON со всеми его лидами (стадия, дата последнего изменения), календарными событиями,
справками, которые он подал и которые ещё не одобрены/отклонены, недавними звонками (с исходом --
взял/не взял/отложил) и встречами, у которых ещё нет заметки о том, как они прошли.

Составь короткий список конкретных задач на сегодня (3-7 пунктов), отсортированный по важности.
Для каждой задачи дай: label (короткое действие, например "Позвонить +998911110002") и detail
(почему, одна фраза, например "Резерв истекает завтра" или "Не брал трубку вчера, попробуй снова").

Правила:
- Используй ТОЛЬКО факты из входных данных. Никогда не выдумывай лида, событие или звонок, которого
  нет в списке.
- Резерв (стадия "reserved"), который висит без движения больше 3 дней -- всегда высокий приоритет.
- Событие сегодня или завтра -- напоминание подготовиться.
- Событие из events_missing_notes -- напомни добавить заметку о том, как оно прошло.
- Лид без первого контакта дольше 24 часов, или с последним звонком no_answer -- напомни перезвонить.
- Если реальных срочных задач нет, верни пустой список items -- не выдумывай задачи ради того, чтобы
  список не был пустым.
Сегодняшняя дата: {today}."""

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "daily_briefing",
        "schema": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "detail": {"type": "string"},
                        },
                        "required": ["label", "detail"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["items"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def generate_daily_briefing(facts: dict) -> list[dict]:
    """facts: gather_manager_context's return dict. Returns a list of
    {"label": str, "detail": str} dicts, already prioritized -- the display
    order IS the model's ranking, no further client-side sorting.

    No try/except here, same reasoning as the other app/ai single-shot
    callers (telegram_evaluator.py, client_context.py) -- best-effort
    handling belongs to the caller (the daily-briefing router)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d (%A)")
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT.format(today=today)},
        {"role": "user", "content": json.dumps(facts, ensure_ascii=False, default=str)},
    ]
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
        return json.loads(resp.choices[0].message.content)["items"]
    except Exception:
        logger.exception("Daily briefing generation failed")
        raise
