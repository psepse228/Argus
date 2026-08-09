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


def test_generate_company_summary_strips_raw_utc_event_at_before_prompting(monkeypatch):
    """Regression test for the exact bug caught live (2026-08-10): the
    model must never see the raw UTC event_at, only event_at_local -- see
    app/tenant_time.py for why. Otherwise it can (and did) report the UTC
    number verbatim as if it were the real local meeting time."""
    captured = {}

    class FakeMessage:
        content = json.dumps({"narrative": "ok", "highlights": []})

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
    mod.generate_company_summary({
        "leads_by_stage": {},
        "today_events": [{"id": "e1", "title": "Подписание справки", "event_at": "2026-08-09T12:00:00+00:00", "event_at_local": "17:00"}],
    })

    prompt_json = captured["messages"][1]["content"]
    assert "event_at_local" in prompt_json
    assert "17:00" in prompt_json
    assert "2026-08-09T12:00:00" not in prompt_json


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


def test_generate_company_summary_translates_stage_keys_before_prompting(monkeypatch):
    captured = {}

    class FakeMessage:
        content = json.dumps({"narrative": "Всё стабильно.", "highlights": []})

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
    facts = {
        "leads_by_stage": {"matching": 3, "reserved": 1},
        "buildings": [],
        "pending_spravki": [],
        "today_events": [],
    }
    mod.generate_company_summary(facts)

    user_content = captured["messages"][1]["content"]
    payload = json.loads(user_content)
    assert payload["leads_by_stage"]["Подбор"] == 3
    assert payload["leads_by_stage"]["Бронь"] == 1
    assert "matching" not in payload["leads_by_stage"]
    assert "reserved" not in payload["leads_by_stage"]


def test_generate_company_summary_passes_through_unrecognized_stage_key(monkeypatch):
    captured = {}

    class FakeMessage:
        content = json.dumps({"narrative": "Всё стабильно.", "highlights": []})

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
    facts = {
        "leads_by_stage": {"some_future_stage": 2},
        "buildings": [],
        "pending_spravki": [],
        "today_events": [],
    }
    mod.generate_company_summary(facts)

    user_content = captured["messages"][1]["content"]
    payload = json.loads(user_content)
    assert payload["leads_by_stage"]["some_future_stage"] == 2


def test_generate_company_summary_does_not_mutate_input_facts(monkeypatch):
    class FakeMessage:
        content = json.dumps({"narrative": "Всё стабильно.", "highlights": []})

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

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    facts = {
        "leads_by_stage": {"matching": 3, "reserved": 1},
        "buildings": [],
        "pending_spravki": [],
        "today_events": [],
    }
    mod.generate_company_summary(facts)

    assert facts["leads_by_stage"] == {"matching": 3, "reserved": 1}
