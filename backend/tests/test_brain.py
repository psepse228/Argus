from app.ai import brain


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = list(rows)

    def select(self, *a, **k):
        return self

    def eq(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) == value]
        return self

    def order(self, *a, **k):
        return self

    def execute(self):
        return _FakeResult(self._rows)


class _FakeClient:
    def __init__(self, tables: dict):
        self._tables = tables

    def table(self, name):
        return _FakeQuery(self._tables.get(name, []))


def test_gather_client_context_returns_empty_dict_when_client_not_found():
    fake = _FakeClient({"clients": []})
    assert brain.gather_client_context(fake, "tenant-1", "client-1") == {}


def test_gather_client_context_does_not_leak_across_tenants():
    fake = _FakeClient({
        "clients": [{
            "id": "client-1", "tenant_id": "tenant-1", "name": "A",
            "phone": "+1", "priority": None, "next_followup_note": None,
        }],
    })
    assert brain.gather_client_context(fake, "tenant-2", "client-1") == {}


def test_gather_client_context_assembles_full_picture():
    fake = _FakeClient({
        "clients": [{
            "id": "client-1", "tenant_id": "tenant-1", "name": "Сардор",
            "phone": "+998911110001", "priority": "hot", "next_followup_note": "перезвонить в среду",
        }],
        "leads": [{
            "client_id": "client-1", "stage": "matching", "source": "instagram",
            "buy_intent": None, "created_at": "2026-08-01T00:00:00Z",
        }],
        "spravka_requests": [{
            "client_id": "client-1", "status": "pending", "plan_type": "installment",
            "created_at": "2026-08-02T00:00:00Z",
        }],
        "telegram_conversations": [{
            "client_id": "client-1", "tenant_id": "tenant-1",
            "summary": "Спросил про Milano, бюджет до 100к", "next_step_suggestion": "Уточнить площадь",
        }],
    })
    ctx = brain.gather_client_context(fake, "tenant-1", "client-1")
    assert ctx["name"] == "Сардор"
    assert ctx["phone"] == "+998911110001"
    assert ctx["priority"] == "hot"
    assert ctx["next_followup_note"] == "перезвонить в среду"
    assert len(ctx["leads"]) == 1 and ctx["leads"][0]["stage"] == "matching"
    assert len(ctx["spravka_requests"]) == 1
    assert ctx["telegram_summary"]["summary"] == "Спросил про Milano, бюджет до 100к"


def test_gather_client_context_no_telegram_conversation_is_none_not_missing_key():
    fake = _FakeClient({
        "clients": [{
            "id": "client-1", "tenant_id": "tenant-1", "name": None,
            "phone": "+998911110002", "priority": None, "next_followup_note": None,
        }],
        "leads": [], "spravka_requests": [], "telegram_conversations": [],
    })
    ctx = brain.gather_client_context(fake, "tenant-1", "client-1")
    assert ctx["telegram_summary"] is None


def test_gather_client_context_only_returns_leads_for_this_client():
    fake = _FakeClient({
        "clients": [{
            "id": "client-1", "tenant_id": "tenant-1", "name": "A",
            "phone": "+1", "priority": None, "next_followup_note": None,
        }],
        "leads": [
            {"client_id": "client-1", "stage": "matching", "source": None, "buy_intent": None, "created_at": "2026-08-01T00:00:00Z"},
            {"client_id": "client-2", "stage": "reserved", "source": None, "buy_intent": None, "created_at": "2026-08-01T00:00:00Z"},
        ],
        "spravka_requests": [], "telegram_conversations": [],
    })
    ctx = brain.gather_client_context(fake, "tenant-1", "client-1")
    assert len(ctx["leads"]) == 1
    assert ctx["leads"][0]["stage"] == "matching"
