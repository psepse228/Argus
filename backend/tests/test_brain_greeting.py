import json
from datetime import datetime, timedelta, timezone


def test_generate_greeting_returns_calm_message_for_empty_items_without_calling_openai(monkeypatch):
    import app.ai.brain_greeting as mod

    def _boom():
        raise AssertionError("should not be called")

    monkeypatch.setattr(mod, "_get_client", _boom)

    result = mod.generate_greeting([])

    assert result == mod._CALM_GREETING


def test_generate_greeting_calls_openai_and_returns_its_text(monkeypatch):
    class FakeMessage:
        content = '{"text": "Доброе утро, три дела ждут."}'

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeCompletions:
        def create(self, **kwargs):
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    import app.ai.brain_greeting as mod
    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())

    items = [{
        "summary": "Позвонить +998911110002",
        "detail": "Резерв висит без движения",
        "priority": "high",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }]
    result = mod.generate_greeting(items)

    assert result == "Доброе утро, три дела ждут."


def test_generate_greeting_marks_persisting_items_correctly(monkeypatch):
    captured = {}

    class FakeMessage:
        content = '{"text": "ok"}'

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeCompletions:
        def create(self, **kwargs):
            captured["messages"] = kwargs["messages"]
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    import app.ai.brain_greeting as mod
    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())

    items = [
        {
            "summary": "Новая задача",
            "detail": "Только что появилась",
            "priority": "normal",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        {
            "summary": "Старая задача",
            "detail": "Висит давно",
            "priority": "high",
            "created_at": (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(),
        },
    ]
    mod.generate_greeting(items)

    payload = json.loads(captured["messages"][1]["content"])
    assert len(payload) == 2

    new_item = payload[0]
    assert new_item["is_new"] is True
    assert abs(new_item["persisted_hours"] - 0) <= 1

    old_item = payload[1]
    assert old_item["is_new"] is False
    assert abs(old_item["persisted_hours"] - 24) <= 1


def test_generate_greeting_falls_back_on_openai_failure(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            raise RuntimeError("boom")

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    import app.ai.brain_greeting as mod
    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())

    items = [
        {
            "summary": "Задача 1",
            "detail": None,
            "priority": "high",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        {
            "summary": "Задача 2",
            "detail": None,
            "priority": "normal",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    ]
    result = mod.generate_greeting(items)

    assert result == "Открытых дел от Argus Brain: 2."
