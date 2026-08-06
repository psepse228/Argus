"""Single-shot GPT-4o call that turns gather_company_context's tenant-wide
rollup (backend/app/ai/brain.py) into a short narrative for the boss's
on-demand "Сводка" AI summary (Phase 3 of Argus Brain) -- read on click, not
polled, not cached (see docs/superpowers/specs/2026-08-05-argus-brain-design.md,
"Owner live summary"). Same discipline as daily_briefing.py/
client_segmentation.py: never invent a fact that isn't in the input.
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


_SYSTEM_PROMPT = """Ты помогаешь руководителю отдела продаж недвижимости понять, как идут дела
прямо сейчас. На входе -- JSON со сводкой по всей компании: количество лидов по стадиям воронки,
список зданий с юнитами в продаже и минимальной ценой за м², все справки, которые ждут решения, и
календарные события на сегодня по всем менеджерам.

Напиши короткую сводку (narrative, 2-4 предложения на русском) -- обычным связным текстом, не
списком: что происходит, что идёт хорошо, на что стоит обратить внимание. Затем дай 2-5 конкретных
пунктов (highlights) с коротким label (например "7 лидов в подборе") и detail (пояснение, почему это
важно, например "Ни один не двигался больше 5 дней").

Правила:
- Используй ТОЛЬКО данные из входного JSON. Никогда не выдумывай числа, здания, лидов или события,
  которых там нет.
- Если справок ждёт решения больше 3 -- обязательно упомяни это как отдельный highlight.
- Если данных мало (например, лидов и событий почти нет), narrative может быть короче, но не
  выдумывай активность, которой не было."""

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "company_summary",
        "schema": {
            "type": "object",
            "properties": {
                "narrative": {"type": "string"},
                "highlights": {
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
            "required": ["narrative", "highlights"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def generate_company_summary(facts: dict) -> dict:
    """facts: gather_company_context's return dict. Returns
    {"narrative": str, "highlights": [{"label", "detail"}]}.

    No try/except here, same reasoning as the other app/ai single-shot
    callers -- best-effort handling belongs to the caller (the
    company-summary router)."""
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(facts, ensure_ascii=False, default=str)},
    ]
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
        return json.loads(resp.choices[0].message.content)
    except Exception:
        logger.exception("Company summary generation failed")
        raise
