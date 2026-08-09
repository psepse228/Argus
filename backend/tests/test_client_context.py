"""app/ai/client_context.py had zero test coverage before this file. Focus
here is the known_buildings grounding added 2026-08-10 after a live QA pass
found a handover brief naming a building ("Roma") the client had no real
lead/справка record for at all -- most likely inherited verbatim from an
already-hallucinated telegram_summary and repeated as fact.
"""
import json

import app.ai.client_context as mod


def _fake_client(captured):
    class FakeMessage:
        content = json.dumps({"summary": "ok"})

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

    return FakeClient()


def test_known_buildings_derived_from_leads_and_spravka_requests():
    client_data = {
        "leads": [{"buildings": {"name": "Florencia"}}],
        "spravka_requests": [{"units": {"buildings": {"name": "Milano"}}}],
    }
    assert mod._known_buildings(client_data) == ["Florencia", "Milano"]


def test_known_buildings_ignores_records_with_no_building():
    client_data = {
        "leads": [{"buildings": None}, {}],
        "spravka_requests": [{"units": {}}, {}],
    }
    assert mod._known_buildings(client_data) == []


def test_known_buildings_deduplicates():
    client_data = {
        "leads": [{"buildings": {"name": "Milano"}}],
        "spravka_requests": [{"units": {"buildings": {"name": "Milano"}}}],
    }
    assert mod._known_buildings(client_data) == ["Milano"]


def test_summarize_client_context_includes_known_buildings_in_the_prompt(monkeypatch):
    captured = {}
    monkeypatch.setattr(mod, "_get_client", lambda: _fake_client(captured))

    mod.summarize_client_context({
        "name": "Иванов", "phone": "+998...",
        "leads": [{"buildings": {"name": "Florencia"}}],
        "spravka_requests": [{"units": {"buildings": {"name": "Milano"}}}],
        "telegram_summary": {"summary": "Клиент упомянул интерес к Roma", "next_step_suggestion": None},
    })

    prompt_json = json.loads(captured["messages"][1]["content"])
    assert prompt_json["known_buildings"] == ["Florencia", "Milano"]
    # The ungrounded telegram_summary text is still passed through as-is --
    # grounding happens via instruction + known_buildings, not by censoring
    # the input -- the model needs to see the real telegram summary to write
    # a useful brief at all.
    assert "Roma" in prompt_json["telegram_summary"]["summary"]


def test_summarize_client_context_returns_the_summary_string(monkeypatch):
    captured = {}
    monkeypatch.setattr(mod, "_get_client", lambda: _fake_client(captured))

    result = mod.summarize_client_context({"leads": [], "spravka_requests": []})

    assert result == "ok"
