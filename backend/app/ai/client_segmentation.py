"""GPT-4o structured-output call that turns a client list into a boss-facing
"what needs attention" digest -- the "exceed Macro with AI-assisted
segmentation" half of the Клиенты overhaul (Macro itself is manual sorting
only, per the client's own assessment). One shot, same shape as
telegram_evaluator.py's single-judgment call -- not the multi-turn
function-calling loop in app/ai/chat.py.
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


_SYSTEM_PROMPT = """Ты помогаешь руководителю отдела продаж недвижимости расставить приоритеты по
списку клиентов. На входе — таблица клиентов с их приоритетом (hot/warm/cold), количеством лидов и
справок, зданиями, которыми интересовались, менеджером и датой последней активности.

Раздели клиентов на 2-4 практичных сегмента для действия прямо сегодня (например: "Горячие без
активности 3+ дня", "Интересуются несколькими зданиями", "Новые без обработки"). Для каждого сегмента
дай короткую метку (label), список id клиентов, которые в него входят (client_ids), и однострочную
причину (reason) на русском.

Используй только данные из входного списка — никогда не выдумывай клиентов, зданий или дат, которых
там нет. Каждый client_id в ответе должен быть взят дословно из входного списка. Если сегментировать
не на что (слишком мало данных), верни пустой список segments."""

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "client_segments",
        "schema": {
            "type": "object",
            "properties": {
                "segments": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "reason": {"type": "string"},
                            "client_ids": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["label", "reason", "client_ids"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["segments"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def segment_clients(summaries: list[dict]) -> dict:
    """summaries: [{"id", "name", "phone", "priority", "leads_count",
    "spravka_count", "buildings", "assigned_manager", "last_activity_at"}, ...]
    Returns {"segments": [{"label", "reason", "client_ids"}, ...]}.

    No try/except here, same reasoning as telegram_evaluator.evaluate_conversation
    -- best-effort handling belongs to the caller (the clients router)."""
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(summaries, ensure_ascii=False)},
    ]
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
        result = json.loads(resp.choices[0].message.content)
    except Exception:
        logger.exception("Client segmentation failed")
        raise
    # The model is instructed to only echo ids it was given, but a strict
    # server-side filter costs nothing and removes any chance of a
    # hallucinated id reaching the frontend as if it were a real client.
    valid_ids = {s["id"] for s in summaries}
    for seg in result["segments"]:
        seg["client_ids"] = [cid for cid in seg["client_ids"] if cid in valid_ids]
    result["segments"] = [seg for seg in result["segments"] if seg["client_ids"]]
    return result
