import json

import app.ai.company_summary as mod


def test_generate_company_summary_parses_response(monkeypatch):
    class FakeMessage:
        content = json.dumps({
            "narrative": "Воронка растёт, но 4 справки ждут решения больше суток.",
            "highlights": [{"label": "4 справки ждут", "detail": "Дольше 24 часов без решения"}],
        })

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeCompletions:
        def create(self, **kwargs):
            assert kwargs["model"] == "gpt-4o"
            assert kwargs["response_format"] == mod._SCHEMA
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    result = mod.generate_company_summary({"leads_by_stage": {"matching": 3}})
    assert result["narrative"].startswith("Воронка растёт")
    assert result["highlights"][0]["label"] == "4 справки ждут"


def test_generate_company_summary_propagates_openai_failure(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            raise RuntimeError("boom")

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    try:
        mod.generate_company_summary({})
        assert False, "expected RuntimeError to propagate"
    except RuntimeError:
        pass
