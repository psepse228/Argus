import pytest


def test_generate_daily_briefing_parses_response(monkeypatch):
    class FakeMessage:
        content = '{"items": [{"label": "Позвонить +998911110002", "detail": "Резерв истекает завтра"}]}'

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    import app.ai.daily_briefing as mod
    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())

    result = mod.generate_daily_briefing({"leads": [], "calendar_events": []})

    assert result == [{"label": "Позвонить +998911110002", "detail": "Резерв истекает завтра"}]
    assert captured["model"] == "gpt-4o"
    assert captured["messages"][0]["role"] == "system"
    assert captured["messages"][1]["role"] == "user"


def test_generate_daily_briefing_propagates_openai_failure(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            raise RuntimeError("boom")

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    import app.ai.daily_briefing as mod
    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())

    with pytest.raises(RuntimeError, match="boom"):
        mod.generate_daily_briefing({"leads": []})
