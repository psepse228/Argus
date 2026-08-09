"""app/ai/chat.py's run_chat -- the shared function-calling loop behind both
assistants -- had zero test coverage before this file, despite being the
core AI feature. Found via a live QA pass (2026-08-10): any tool whose
result is a plain list (get_units, get_pending_approvals,
get_payment_plan_rates) crashed the whole request with a 500
(`AttributeError: 'list' object has no attribute 'get'`), since run_chat
unconditionally called `result.get("error")` on every tool result. Since
asking about unit availability/pricing is one of the most common things a
rep would ask, this made the assistant look broken for a large share of
real questions.
"""
import app.ai.chat as mod


class FakeFunction:
    def __init__(self, name, arguments):
        self.name = name
        self.arguments = arguments


class FakeToolCall:
    def __init__(self, id_, name, arguments="{}"):
        self.id = id_
        self.function = FakeFunction(name, arguments)


class FakeMessage:
    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls or []

    def model_dump(self, exclude_none=True):
        d = {"role": "assistant", "content": self.content, "tool_calls": self.tool_calls or None}
        return {k: v for k, v in d.items() if not (exclude_none and v is None)}


class FakeChoice:
    def __init__(self, message):
        self.message = message


class FakeResponse:
    def __init__(self, message):
        self.choices = [FakeChoice(message)]


def _fake_client(responses):
    """responses: a list of FakeResponse, returned in order across
    successive .create() calls (one per round of the tool-call loop)."""
    calls = iter(responses)

    class FakeCompletions:
        def create(self, **kwargs):
            return next(calls)

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    return FakeClient()


def test_run_chat_handles_a_tool_result_that_is_a_plain_list(monkeypatch):
    """Regression test for the exact crash found live: get_units-shaped
    tools return a bare list, not {"data": [...]}."""
    tool_call_response = FakeResponse(FakeMessage(tool_calls=[FakeToolCall("call_1", "get_units")]))
    final_response = FakeResponse(FakeMessage(content="В доме Milano 3 свободных юнита."))
    monkeypatch.setattr(mod, "_get_client", lambda: _fake_client([tool_call_response, final_response]))
    monkeypatch.setattr(mod, "call_function", lambda name, args, tenant_id, requester_email: [
        {"unit_number": "101", "status": "for_sale"},
    ])

    reply, events = mod.run_chat("system", "Сколько юнитов в Milano?", "t1", [])

    assert reply == "В доме Milano 3 свободных юнита."
    tool_events = [e for e in events if e["type"] == "tool_call"]
    assert tool_events == [{"type": "tool_call", "name": "get_units", "ok": True}]


def test_run_chat_still_detects_a_dict_shaped_tool_error(monkeypatch):
    """The list-result fix must not regress the existing dict-shaped
    {"error": "..."} convention used by set_payment_plan_rate/
    create_spravka_request."""
    tool_call_response = FakeResponse(FakeMessage(tool_calls=[FakeToolCall("call_1", "set_payment_plan_rate")]))
    final_response = FakeResponse(FakeMessage(content="Не удалось обновить тариф."))
    monkeypatch.setattr(mod, "_get_client", lambda: _fake_client([tool_call_response, final_response]))
    monkeypatch.setattr(mod, "call_function", lambda name, args, tenant_id, requester_email: {"error": "No building named 'Atlantis'"})

    reply, events = mod.run_chat("system", "Обнови тариф для Atlantis", "t1", [])

    tool_events = [e for e in events if e["type"] == "tool_call"]
    assert tool_events == [{"type": "tool_call", "name": "set_payment_plan_rate", "ok": False}]
    confidence = next(e for e in events if e["type"] == "confidence")
    assert confidence["level"] == "medium"  # had_error=True from the failed tool call


def test_run_chat_still_emits_spravka_created_event(monkeypatch):
    spravka_result = {
        "ok": True, "request_id": "req-1", "status": "pending",
        "unit_number": "38", "building": "Milano", "real_price_per_m2_usd": 1500,
    }
    tool_call_response = FakeResponse(FakeMessage(tool_calls=[FakeToolCall("call_1", "create_spravka_request")]))
    final_response = FakeResponse(FakeMessage(content="Готово, справка создана."))
    monkeypatch.setattr(mod, "_get_client", lambda: _fake_client([tool_call_response, final_response]))
    monkeypatch.setattr(mod, "call_function", lambda name, args, tenant_id, requester_email: spravka_result)

    reply, events = mod.run_chat("system", "Оформи справку на юнит 38", "t1", [])

    created = [e for e in events if e["type"] == "spravka_created"]
    assert len(created) == 1
    assert created[0]["request_id"] == "req-1"


def test_run_chat_returns_directly_when_the_model_makes_no_tool_calls(monkeypatch):
    response = FakeResponse(FakeMessage(content="Привет! Чем могу помочь?"))
    monkeypatch.setattr(mod, "_get_client", lambda: _fake_client([response]))

    reply, events = mod.run_chat("system", "Привет", "t1", [])

    assert reply == "Привет! Чем могу помочь?"
    assert events == [{"type": "confidence", "level": "high"}]


def test_run_chat_handles_a_function_call_that_raises(monkeypatch):
    """call_function raising an exception (not returning {"error": ...})
    must still be caught and reported as a failed tool call, not crash."""
    tool_call_response = FakeResponse(FakeMessage(tool_calls=[FakeToolCall("call_1", "get_units")]))
    final_response = FakeResponse(FakeMessage(content="Не удалось получить данные."))
    monkeypatch.setattr(mod, "_get_client", lambda: _fake_client([tool_call_response, final_response]))

    def boom(name, args, tenant_id, requester_email):
        raise RuntimeError("Supabase timeout")

    monkeypatch.setattr(mod, "call_function", boom)

    reply, events = mod.run_chat("system", "Сколько юнитов?", "t1", [])

    tool_events = [e for e in events if e["type"] == "tool_call"]
    assert tool_events == [{"type": "tool_call", "name": "get_units", "ok": False}]
