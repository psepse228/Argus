import pytest


def test_evaluate_conversation_parses_response_and_maps_roles(monkeypatch):
    class FakeMessage:
        content = '{"summary": "s", "next_step": "n", "draft_reply": "d"}'

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

    import app.ai.telegram_evaluator as mod
    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())

    result = mod.evaluate_conversation([
        {"role": "client", "content": "Здравствуйте, интересует юнит в Milano"},
        {"role": "manager", "content": "Добрый день! Уточните бюджет?"},
    ])

    assert result == {"summary": "s", "next_step": "n", "draft_reply": "d"}
    assert captured["model"] == "gpt-4o"
    assert captured["messages"][1] == {"role": "user", "content": "Здравствуйте, интересует юнит в Milano"}
    assert captured["messages"][2] == {"role": "assistant", "content": "Добрый день! Уточните бюджет?"}


def test_evaluate_conversation_propagates_openai_failure(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            raise RuntimeError("boom")

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    import app.ai.telegram_evaluator as mod
    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())

    with pytest.raises(RuntimeError, match="boom"):
        mod.evaluate_conversation([
            {"role": "client", "content": "Здравствуйте"},
        ])
