import uuid
from datetime import datetime, timedelta, timezone

import app.ai.brain_items as mod


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, table_rows, all_tables, table_name):
        self._rows = list(table_rows)
        self._all_tables = all_tables
        self._table_name = table_name
        self._pending_update = None

    def select(self, *a, **k):
        return self

    def eq(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) == value]
        return self

    def neq(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) != value]
        return self

    def in_(self, column, values):
        self._rows = [r for r in self._rows if r.get(column) in values]
        return self

    def is_(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) is None]
        return self

    def gte(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) is not None and r[column] >= value]
        return self

    def order(self, column, desc=False):
        self._rows = sorted(self._rows, key=lambda r: (r.get(column) is None, r.get(column)), reverse=desc)
        return self

    def limit(self, *a, **k):
        return self

    def insert(self, payload):
        row = {"id": str(uuid.uuid4()), **payload}
        self._all_tables.setdefault(self._table_name, []).append(row)
        self._rows = [row]
        return self

    def update(self, payload):
        # Deferred to execute(): brain_items.py chains `.update(payload).eq("id", x)`,
        # i.e. the filter arrives AFTER update() in the call chain. Applying the
        # payload here (before eq() has narrowed self._rows) would stamp every row
        # currently in the table, not just the one eq() is about to select -- so we
        # stash it and apply it once eq()/etc. have had their say, at execute() time.
        self._pending_update = payload
        return self

    def execute(self):
        if self._pending_update is not None:
            for r in self._rows:
                r.update(self._pending_update)
        return _FakeResult(self._rows)


class _FakeClient:
    def __init__(self, tables: dict):
        self._tables = tables

    def table(self, name):
        return _FakeQuery(self._tables.setdefault(name, []), self._tables, name)


def _base_tables(**overrides):
    tables = {
        "tenant_users": [{"tenant_id": "tenant-1", "email": "a@x.com", "name": "Азиз"}],
        "leads": [], "calendar_events": [], "meeting_notes": [],
        "spravka_requests": [], "call_logs": [], "ai_events": [], "brain_items": [],
    }
    tables.update(overrides)
    return tables


def test_sync_brain_items_inserts_new_candidate_as_open(monkeypatch):
    fake = _FakeClient(_base_tables(
        leads=[{"tenant_id": "tenant-1", "assigned_manager": "Азиз", "client_id": "client-1", "id": "lead-1", "stage": "reserved"}],
    ))
    candidate = {
        "kind": "stale_lead", "ref_table": "leads", "ref_id": "lead-1", "client_id": "client-1",
        "summary": "Позвонить +998911110002", "detail": "Резерв висит без движения", "priority": "high",
    }
    monkeypatch.setattr(mod, "_generate_candidates", lambda facts: [candidate])
    monkeypatch.setattr(mod, "_promoted_ai_event_candidates", lambda client, tenant_id, manager_email: [])

    result = mod.sync_brain_items(fake, "tenant-1", "a@x.com")

    assert len(result) == 1
    assert result[0]["summary"] == "Позвонить +998911110002"
    assert result[0]["status"] == "open"


def test_sync_brain_items_does_not_resurrect_a_dismissed_item(monkeypatch):
    fake = _FakeClient(_base_tables(
        leads=[{"tenant_id": "tenant-1", "assigned_manager": "Азиз", "client_id": "client-1", "id": "lead-1", "stage": "reserved"}],
        brain_items=[{
            "id": "existing-1", "tenant_id": "tenant-1", "assigned_to": "a@x.com",
            "kind": "stale_lead", "dedupe_key": "leads:lead-1", "client_id": "client-1",
            "summary": "Старая задача", "detail": "Старая причина", "priority": "high",
            "status": "dismissed", "created_at": "2026-08-01T00:00:00+00:00", "resolved_at": None,
        }],
    ))
    candidate = {
        "kind": "stale_lead", "ref_table": "leads", "ref_id": "lead-1", "client_id": "client-1",
        "summary": "Новая задача", "detail": "Новая причина", "priority": "high",
    }
    monkeypatch.setattr(mod, "_generate_candidates", lambda facts: [candidate])
    monkeypatch.setattr(mod, "_promoted_ai_event_candidates", lambda client, tenant_id, manager_email: [])

    result = mod.sync_brain_items(fake, "tenant-1", "a@x.com")

    assert result == []
    row = next(r for r in fake._tables["brain_items"] if r["dedupe_key"] == "leads:lead-1")
    assert row["status"] == "dismissed"
    assert row["summary"] == "Старая задача"
    assert row["detail"] == "Старая причина"


def test_sync_brain_items_auto_resolves_when_candidate_disappears(monkeypatch):
    fake = _FakeClient(_base_tables(
        brain_items=[{
            "id": "row-1", "tenant_id": "tenant-1", "assigned_to": "a@x.com",
            "kind": "stale_lead", "dedupe_key": "leads:lead-1", "client_id": "client-1",
            "summary": "s", "detail": "d", "priority": "normal",
            "status": "open", "created_at": "2026-08-01T00:00:00+00:00", "resolved_at": None,
        }],
    ))
    monkeypatch.setattr(mod, "_generate_candidates", lambda facts: [])
    monkeypatch.setattr(mod, "_promoted_ai_event_candidates", lambda client, tenant_id, manager_email: [])

    result = mod.sync_brain_items(fake, "tenant-1", "a@x.com")

    assert result == []
    row = next(r for r in fake._tables["brain_items"] if r["id"] == "row-1")
    assert row["status"] == "done"
    assert row["resolved_at"] is not None


def test_sync_brain_items_promotes_undecided_ai_events(monkeypatch):
    recent = datetime.now(timezone.utc).isoformat()
    fake = _FakeClient(_base_tables(
        ai_events=[{
            "id": "ev-1", "tenant_id": "tenant-1", "manager_email": "a@x.com",
            "kind": "coaching_tip", "client_id": "client-1", "summary": "Совет: перезвони клиенту",
            "outcome": None, "related_id": None, "created_at": recent,
        }],
    ))
    monkeypatch.setattr(mod, "_generate_candidates", lambda facts: [])

    result = mod.sync_brain_items(fake, "tenant-1", "a@x.com")

    assert len(result) == 1
    assert result[0]["kind"] == "coaching_tip"
    assert result[0]["summary"] == "Совет: перезвони клиенту"


def test_sync_brain_items_ignores_decided_ai_events(monkeypatch):
    recent = datetime.now(timezone.utc).isoformat()
    fake = _FakeClient(_base_tables(
        ai_events=[{
            "id": "ev-1", "tenant_id": "tenant-1", "manager_email": "a@x.com",
            "kind": "coaching_tip", "client_id": "client-1", "summary": "Совет: перезвони клиенту",
            "outcome": "confirmed", "related_id": None, "created_at": recent,
        }],
    ))
    monkeypatch.setattr(mod, "_generate_candidates", lambda facts: [])

    result = mod.sync_brain_items(fake, "tenant-1", "a@x.com")

    assert result == []


def test_sync_brain_items_still_works_after_refactor(monkeypatch):
    """Regression check for the _upsert_and_resolve extraction: sync_brain_items
    must still insert new candidates, leave decided rows alone, and auto-resolve
    disappeared candidates -- exactly as before the refactor."""
    fake = _FakeClient(_base_tables(
        leads=[{"tenant_id": "tenant-1", "assigned_manager": "Азиз", "client_id": "client-1", "id": "lead-1", "stage": "reserved"}],
        brain_items=[{
            "id": "stale-row", "tenant_id": "tenant-1", "assigned_to": "a@x.com",
            "kind": "stale_lead", "dedupe_key": "leads:lead-999", "client_id": "client-9",
            "summary": "s", "detail": "d", "priority": "normal",
            "status": "open", "created_at": "2026-08-01T00:00:00+00:00", "resolved_at": None,
        }],
    ))
    candidate = {
        "kind": "stale_lead", "ref_table": "leads", "ref_id": "lead-1", "client_id": "client-1",
        "summary": "Позвонить +998911110002", "detail": "Резерв висит без движения", "priority": "high",
    }
    monkeypatch.setattr(mod, "_generate_candidates", lambda facts: [candidate])
    monkeypatch.setattr(mod, "_promoted_ai_event_candidates", lambda client, tenant_id, manager_email: [])
    monkeypatch.setattr(mod, "_unconfirmed_event_candidates", lambda facts: [])

    result = mod.sync_brain_items(fake, "tenant-1", "a@x.com")

    assert len(result) == 1
    assert result[0]["summary"] == "Позвонить +998911110002"
    assert result[0]["status"] == "open"
    stale = next(r for r in fake._tables["brain_items"] if r["id"] == "stale-row")
    assert stale["status"] == "done"
    assert stale["resolved_at"] is not None


def test_unconfirmed_event_candidates_includes_proposed_events():
    facts = {
        "calendar_events": [{
            "id": "e1", "status": "proposed", "event_at": "2026-08-10T14:00:00+00:00",
            "client_id": "c1", "clients": {"name": "Азиз", "phone": "+998..."},
        }],
    }

    result = mod._unconfirmed_event_candidates(facts)

    assert len(result) == 1
    item = result[0]
    assert item["kind"] == "unconfirmed_event"
    assert item["ref_table"] == "calendar_events"
    assert item["ref_id"] == "e1"
    assert item["client_id"] == "c1"
    assert "Азиз" in item["summary"]


def test_unconfirmed_event_candidates_ignores_non_proposed():
    facts = {
        "calendar_events": [{
            "id": "e1", "status": "confirmed", "event_at": "2026-08-10T14:00:00+00:00",
            "client_id": "c1", "clients": {"name": "Азиз", "phone": "+998..."},
        }],
    }

    result = mod._unconfirmed_event_candidates(facts)

    assert result == []


def test_sync_boss_brain_items_creates_pending_spravka_items():
    fake = _FakeClient(_base_tables(
        spravka_requests=[
            {
                "id": "s1", "tenant_id": "tenant-1", "client_id": "client-1", "status": "pending",
                "units": {"unit_number": "12", "buildings": {"name": "Milano"}},
            },
            {
                "id": "s2", "tenant_id": "tenant-1", "client_id": "client-2", "status": "approved",
                "units": {"unit_number": "99", "buildings": {"name": "Other"}},
            },
        ],
    ))

    result = mod.sync_boss_brain_items(fake, "tenant-1", "boss@x.com")

    assert len(result) == 1
    item = result[0]
    assert item["kind"] == "pending_spravka_approval"
    assert item["assigned_to"] == "boss@x.com"
    combined = f"{item['summary']} {item['detail']}"
    assert "12" in combined
    assert "Milano" in combined


def test_sync_boss_brain_items_respects_dismissal():
    fake = _FakeClient(_base_tables(
        spravka_requests=[{
            "id": "s1", "tenant_id": "tenant-1", "client_id": "client-1", "status": "pending",
            "units": {"unit_number": "12", "buildings": {"name": "Milano"}},
        }],
        brain_items=[{
            "id": "existing-1", "tenant_id": "tenant-1", "assigned_to": "boss@x.com",
            "kind": "pending_spravka_approval", "dedupe_key": "spravka_requests:s1", "client_id": "client-1",
            "summary": "Одобрить справку — №12", "detail": "Milano", "priority": "high",
            "status": "dismissed", "created_at": "2026-08-01T00:00:00+00:00", "resolved_at": None,
        }],
    ))

    result = mod.sync_boss_brain_items(fake, "tenant-1", "boss@x.com")

    assert result == []
    row = next(r for r in fake._tables["brain_items"] if r["dedupe_key"] == "spravka_requests:s1")
    assert row["status"] == "dismissed"


def test_generate_candidates_drops_hallucinated_ref_id(monkeypatch):
    class FakeMessage:
        content = (
            '{"items": [{"kind": "stale_lead", "ref_table": "leads", "ref_id": "fake-lead", '
            '"client_id": null, "summary": "Позвонить", "detail": "Причина", "priority": "normal"}]}'
        )

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

    facts = {"leads": [{"id": "real-lead"}]}
    result = mod._generate_candidates(facts)

    assert result == []
