"""Shared fake Supabase client/query-builder for router unit tests -- same
shape as the one duplicated across test_brain_items.py, test_brain_items_router.py,
etc., pulled out once so new IDOR/security tests don't redefine it again.
Not a test module itself (no test_ prefix), so pytest won't try to collect it.
"""
import uuid


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeQuery:
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
        # Deferred to execute(): callers chain `.update(payload).eq(...)`, i.e.
        # the filter arrives AFTER update() -- applying the payload here (before
        # eq()/etc. have narrowed self._rows) would stamp every row currently in
        # the table, not just the one the filters are about to select.
        self._pending_update = payload
        return self

    def execute(self):
        if self._pending_update is not None:
            for r in self._rows:
                r.update(self._pending_update)
        return FakeResult(self._rows)


class FakeClient:
    def __init__(self, tables: dict):
        self._tables = tables

    def table(self, name):
        return FakeQuery(self._tables.setdefault(name, []), self._tables, name)
