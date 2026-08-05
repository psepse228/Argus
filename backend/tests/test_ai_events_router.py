from app.routers.ai_events import _query_ai_events


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

    def limit(self, *a, **k):
        return self

    def execute(self):
        return _FakeResult(self._rows)


class _FakeClient:
    def __init__(self, rows):
        self._rows = rows

    def table(self, name):
        return _FakeQuery(self._rows)


def test_boss_sees_all_managers_events():
    fake = _FakeClient([
        {"tenant_id": "t1", "manager_email": "a@x.com", "kind": "coaching_tip"},
        {"tenant_id": "t1", "manager_email": "b@x.com", "kind": "coaching_tip"},
    ])
    rows = _query_ai_events(fake, "t1", "boss", "a@x.com")
    assert len(rows) == 2


def test_non_boss_only_sees_own_manager_email():
    fake = _FakeClient([
        {"tenant_id": "t1", "manager_email": "a@x.com", "kind": "coaching_tip"},
        {"tenant_id": "t1", "manager_email": "b@x.com", "kind": "coaching_tip"},
    ])
    rows = _query_ai_events(fake, "t1", "sales_agent", "a@x.com")
    assert len(rows) == 1
    assert rows[0]["manager_email"] == "a@x.com"


def test_non_boss_never_sees_another_managers_row_even_with_kind_filter():
    fake = _FakeClient([
        {"tenant_id": "t1", "manager_email": "a@x.com", "kind": "draft_sent"},
        {"tenant_id": "t1", "manager_email": "b@x.com", "kind": "draft_sent"},
    ])
    rows = _query_ai_events(fake, "t1", "sales_agent", "a@x.com", kind="draft_sent")
    assert len(rows) == 1
    assert rows[0]["manager_email"] == "a@x.com"


def test_tenant_scoping_still_applies_for_boss():
    fake = _FakeClient([
        {"tenant_id": "t1", "manager_email": "a@x.com", "kind": "coaching_tip"},
        {"tenant_id": "t2", "manager_email": "a@x.com", "kind": "coaching_tip"},
    ])
    rows = _query_ai_events(fake, "t1", "boss", "a@x.com")
    assert len(rows) == 1
    assert rows[0]["tenant_id"] == "t1"
