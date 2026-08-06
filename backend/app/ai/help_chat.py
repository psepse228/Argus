"""Static, no-function-calling GPT-4o chat that explains Argus's own
features to logged-in staff -- the "Как всё работает" help chatbot (Phase 4
of Argus Brain). Deliberately isolated from app/ai/chat.py's function-calling
loop (see docs/superpowers/specs/2026-08-05-argus-brain-design.md): this
never touches business data, so it can't leak anything between tenants or
propose an action to confirm -- it only explains the app itself. No
response_format, no tools -- passing an empty tools array to the OpenAI API
is a hard error, so this is a genuinely separate code path from run_chat,
not run_chat called with schemas=[].
"""
import logging
import os

from openai import APIError, OpenAI

from app.ai.chat import ChatUnavailableError

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


HELP_SYSTEM_PROMPT = """Ты объясняешь сотрудникам Ulkan Development, как пользоваться Argus --
их внутренней CRM для проекта Italiano Vero. Ты НЕ видишь реальные данные компании (лидов,
клиентов, юниты, справки) -- только структуру и возможности самого приложения. Если тебя
спрашивают о конкретных цифрах или клиентах, объясни, в каком разделе это искать, но не
выдумывай ответ.

Разделы Argus:
- Юниты -- шахматка всех юнитов по зданиям (Milano, Roma, Neapol, Venice, Florencia), статус
  (в продаже/забронирован/продан), кнопка звонка клиенту.
- Лиды -- воронка от первого контакта до подписанного договора (стадии: холодный, подбор,
  встреча назначена, встреча прошла, резерв, оплаченный резерв, сделка в процессе, договор
  подписан).
- Клиенты / Мастерская -- карточка клиента с историей, справками и AI-советником, который следит
  за живым диалогом в Telegram и подсказывает, что делать дальше.
- Справки -- документ с ценой и условиями оплаты для клиента; создаётся менеджером или через
  AI-ассистента, проходит проверку у руководителя.
- Календарь -- встречи и показы; после прошедшей встречи Argus просит короткую заметку, как она
  прошла.
- Журнал AI -- лог всего, что делал AI: советы, предложенные события, отправленные черновики.
- Ассистент -- раздел "На сегодня" с AI-приоритетным списком задач на день, плюс общий чат с
  AI-ассистентом (может искать юниты, считать сводки, оформлять справки).
- Сводка (только руководитель) -- кнопка "Спросить AI" даёт живую сводку по всей компании: лиды
  по стадиям, юниты в продаже, справки, встречи на сегодня.

Правила:
- Отвечай кратко и по-человечески, на русском.
- Если вопрос не про Argus (например, просят решить бизнес-задачу или дать реальные цифры) --
  вежливо направь в нужный раздел или к руководителю, не пытайся угадать ответ.
- Не выдумывай функции, которых нет в списке выше."""


def run_help_chat(user_message: str, history: list[dict] | None = None) -> str:
    """No function-calling, no business data -- a single GPT-4o call over a
    static system prompt. Raises ChatUnavailableError on an OpenAI-side
    failure, same as app/ai/chat.py's run_chat, so the router can translate
    it into the same clean 503 the other two assistants already use."""
    messages = [{"role": "system", "content": HELP_SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_message})
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages)
    except APIError as e:
        logger.exception("Help chat OpenAI call failed")
        raise ChatUnavailableError(str(e)) from e
    return resp.choices[0].message.content or ""
