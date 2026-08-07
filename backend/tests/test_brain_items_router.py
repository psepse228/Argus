import uuid

import pytest
from fastapi import HTTPException

import app.routers.brain_items as router_mod


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

    def lte(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) is not None and r[column] <= value]
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
        # Deferred to execute(): brain_items.py chains `.update(payload).eq(...)`,
        # i.e. the filter arrives AFTER update() in the call chain. Applying the
        # payload here (before eq()/lte() have narrowed self._rows) would stamp
        # every row currently in the table, not just the ones selected -- so we
        # stash it and apply it once the filters have had their say, at
        # execute() time.
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
        "tenant_users": [],
        "brain_items": [],
    }
    tables.update(overrides)
    return tables


# ---- _sync_and_list ----


def test_sync_and_list_non_boss_only_syncs_self(monkeypatch):
    fake = _FakeClient(_base_tables())
    calls = []

    def fake_sync(client, tenant_id, manager_email):
        calls.append(manager_email)
        return [{"id": f"item-{manager_email}"}]

    monkeypatch.setattr(router_mod, "sync_brain_items", fake_sync)

    result = router_mod._sync_and_list(fake, "t1", "sales_agent", "a@x.com")

    assert calls == ["a@x.com"]
    assert result == [{"id": "item-a@x.com"}]


def test_sync_and_list_boss_syncs_every_manager_and_merges(monkeypatch):
    fake = _FakeClient(_base_tables(
        tenant_users=[
            {"tenant_id": "t1", "email": "m1@x.com", "role": "sales_agent"},
            {"tenant_id": "t1", "email": "m2@x.com", "role": "sales_agent"},
            {"tenant_id": "t1", "email": "boss@x.com", "role": "boss"},
        ],
    ))
    calls = []

    def fake_sync(client, tenant_id, manager_email):
        calls.append(manager_email)
        return [{"id": f"item-{manager_email}", "priority": "normal", "created_at": "2026-01-01T00:00:00+00:00"}]

    monkeypatch.setattr(router_mod, "sync_brain_items", fake_sync)

    result = router_mod._sync_and_list(fake, "t1", "boss", "boss@x.com")

    assert set(calls) == {"m1@x.com", "m2@x.com"}
    assert "boss@x.com" not in calls
    ids = {it["id"] for it in result}
    assert ids == {"item-m1@x.com", "item-m2@x.com"}


def test_sync_and_list_boss_view_sorts_high_priority_first(monkeypatch):
    fake = _FakeClient(_base_tables(
        tenant_users=[
            {"tenant_id": "t1", "email": "m1@x.com", "role": "sales_agent"},
            {"tenant_id": "t1", "email": "m2@x.com", "role": "sales_agent"},
        ],
    ))

    fixed_items = {
        "m1@x.com": [
            {"id": "m1-normal", "priority": "normal", "created_at": "2026-01-01T00:00:00+00:00"},
            {"id": "m1-high", "priority": "high", "created_at": "2026-01-03T00:00:00+00:00"},
        ],
        "m2@x.com": [
            {"id": "m2-high", "priority": "high", "created_at": "2026-01-02T00:00:00+00:00"},
            {"id": "m2-normal", "priority": "normal", "created_at": "2026-01-04T00:00:00+00:00"},
        ],
    }

    def fake_sync(client, tenant_id, manager_email):
        return fixed_items[manager_email]

    monkeypatch.setattr(router_mod, "sync_brain_items", fake_sync)

    result = router_mod._sync_and_list(fake, "t1", "boss", "boss@x.com")

    priorities = [it["priority"] for it in result]
    first_normal_idx = priorities.index("normal")
    assert all(p == "high" for p in priorities[:first_normal_idx])
    assert all(p == "normal" for p in priorities[first_normal_idx:])


def test_sync_and_list_boss_also_includes_boss_only_items(monkeypatch):
    fake = _FakeClient(_base_tables(tenant_users=[]))
    boss_calls = []

    def fake_sync(client, tenant_id, manager_email):
        return []

    def fake_sync_boss(client, tenant_id, boss_email):
        boss_calls.append((tenant_id, boss_email))
        return [{"id": "boss-item-1", "priority": "high", "created_at": "2026-01-01T00:00:00+00:00"}]

    monkeypatch.setattr(router_mod, "sync_brain_items", fake_sync)
    monkeypatch.setattr(router_mod, "sync_boss_brain_items", fake_sync_boss)

    result = router_mod._sync_and_list(fake, "t1", "boss", "boss@x.com")

    ids = {it["id"] for it in result}
    assert "boss-item-1" in ids
    assert boss_calls == [("t1", "boss@x.com")]


# ---- _load_item ----


def test_load_item_404s_for_wrong_tenant():
    item_id = str(uuid.uuid4())
    fake = _FakeClient(_base_tables(
        brain_items=[{"id": item_id, "tenant_id": "t1", "assigned_to": "a@x.com"}],
    ))

    with pytest.raises(HTTPException) as exc_info:
        router_mod._load_item(fake, item_id, "t2", "boss", "boss@x.com")

    assert exc_info.value.status_code == 404


def test_load_item_404s_for_non_boss_viewing_someone_elses_item():
    item_id = str(uuid.uuid4())
    fake = _FakeClient(_base_tables(
        brain_items=[{"id": item_id, "tenant_id": "t1", "assigned_to": "other@x.com"}],
    ))

    with pytest.raises(HTTPException) as exc_info:
        router_mod._load_item(fake, item_id, "t1", "sales_agent", "me@x.com")

    assert exc_info.value.status_code == 404


def test_load_item_succeeds_for_boss_regardless_of_assigned_to():
    item_id = str(uuid.uuid4())
    fake = _FakeClient(_base_tables(
        brain_items=[{"id": item_id, "tenant_id": "t1", "assigned_to": "other@x.com"}],
    ))

    result = router_mod._load_item(fake, item_id, "t1", "boss", "boss@x.com")

    assert result["id"] == item_id


def test_load_item_succeeds_for_matching_manager():
    item_id = str(uuid.uuid4())
    fake = _FakeClient(_base_tables(
        brain_items=[{"id": item_id, "tenant_id": "t1", "assigned_to": "me@x.com"}],
    ))

    result = router_mod._load_item(fake, item_id, "t1", "sales_agent", "me@x.com")

    assert result["id"] == item_id


# ---- _wake_expired_snoozes ----


def test_wake_expired_snoozes_reopens_only_past_due_rows():
    past_id = str(uuid.uuid4())
    future_id = str(uuid.uuid4())
    fake = _FakeClient(_base_tables(
        brain_items=[
            {
                "id": past_id, "tenant_id": "t1", "assigned_to": "me@x.com",
                "status": "snoozed", "snoozed_until": "2020-01-01T00:00:00+00:00",
            },
            {
                "id": future_id, "tenant_id": "t1", "assigned_to": "me@x.com",
                "status": "snoozed", "snoozed_until": "2099-01-01T00:00:00+00:00",
            },
        ],
    ))

    router_mod._wake_expired_snoozes(fake, "t1", "me@x.com")

    rows = {r["id"]: r for r in fake._tables["brain_items"]}
    assert rows[past_id]["status"] == "open"
    assert rows[past_id]["snoozed_until"] is None
    assert rows[future_id]["status"] == "snoozed"
    assert rows[future_id]["snoozed_until"] == "2099-01-01T00:00:00+00:00"
