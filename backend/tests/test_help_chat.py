import app.ai.help_chat as mod
from app.ai.chat import ChatUnavailableError
from openai import APIError


def test_run_help_chat_returns_reply_text(monkeypatch):
    class FakeMessage:
        content = "Юниты — это раздел с шахматкой всех квартир по зданиям."

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeCompletions:
        def create(self, **kwargs):
            assert kwargs["model"] == "gpt-4o"
            assert "tools" not in kwargs
            assert "response_format" not in kwargs
            assert kwargs["messages"][0] == {"role": "system", "content": mod.HELP_SYSTEM_PROMPT}
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    reply = mod.run_help_chat("Что такое Юниты?")
    assert reply == "Юниты — это раздел с шахматкой всех квартир по зданиям."


def test_run_help_chat_includes_history_before_the_new_message(monkeypatch):
    captured = {}

    class FakeMessage:
        content = "ok"

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

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    history = [{"role": "user", "content": "Привет"}, {"role": "assistant", "content": "Привет! Чем помочь?"}]
    mod.run_help_chat("А что такое Лиды?", history=history)
    assert captured["messages"][1:3] == history
    assert captured["messages"][-1] == {"role": "user", "content": "А что такое Лиды?"}


def test_run_help_chat_raises_chat_unavailable_on_api_error(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            raise APIError("boom", request=None, body=None)

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    try:
        mod.run_help_chat("test")
        assert False, "expected ChatUnavailableError"
    except ChatUnavailableError:
        pass
