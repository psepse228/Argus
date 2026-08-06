"""On-demand, first-person greeting generated from a manager's current open
brain_items -- the piece that makes Argus Brain feel like a presence
rather than a report. Same "never invent a fact" discipline as every other
app/ai single-shot caller: the model only phrases what's actually in the
items list, it doesn't get to invent new facts. Skips the OpenAI call
entirely when there's nothing to say -- the calm, no-op case is the most
common one and needs no GPT round trip.
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


_CALM_GREETING = "Всё спокойно — срочных дел не вижу."

_SYSTEM_PROMPT = """Ты -- Argus Brain, AI, который сам следит за работой менеджера по продажам
недвижимости. Тебе передают список его текущих открытых задач (то, что ты сам заметил и на что
стоит обратить внимание). У каждой задачи есть is_new (появилась недавно) и persisted_hours
(сколько часов уже висит нерешённой).

Напиши ОДНО короткое приветствие от первого лица (1-2 предложения, по-русски), как будто ты
реально следишь за делами и сейчас докладываешь о самом важном. Если есть задача с
persisted_hours >= 18 -- обязательно упомяни, что уже предупреждал про неё раньше (например
"я вчера уже говорил про..."), не подавай её как новость. Выбери максимум 1-2 самых важных пункта,
не перечисляй всё подряд -- остальное просто подразумевай количеством, если задач больше.

Никогда не выдумывай задачи, которых нет в списке."""

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "brain_greeting",
        "schema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def _fallback_greeting(items: list[dict]) -> str:
    """Used only if the OpenAI call itself fails -- plain, agreement-free
    phrasing (no Russian noun-plural-agreement edge cases to get wrong in a
    degraded-mode string)."""
    return f"Открытых дел от Argus Brain: {len(items)}."


def generate_greeting(items: list[dict]) -> str:
    """items: brain_items rows (as returned by _sync_and_list), each with
    at least summary/detail/priority/created_at. Returns plain text, never
    raises -- a greeting failing to generate should never break the screen
    that's about to show it."""
    if not items:
        return _CALM_GREETING
    now = datetime.now(timezone.utc)
    payload = []
    for it in items:
        created = datetime.fromisoformat(it["created_at"].replace("Z", "+00:00"))
        hours = (now - created).total_seconds() / 3600
        payload.append({
            "summary": it["summary"], "detail": it.get("detail"), "priority": it["priority"],
            "is_new": hours < 18, "persisted_hours": round(hours),
        })
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
        return json.loads(resp.choices[0].message.content)["text"]
    except Exception:
        logger.exception("Brain greeting generation failed")
        return _fallback_greeting(items)
