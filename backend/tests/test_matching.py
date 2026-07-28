from app.telegram.matching import find_client_by_phone, normalize_phone


def test_normalize_phone_adds_leading_plus():
    assert normalize_phone("998911110009") == "+998911110009"


def test_normalize_phone_leaves_existing_plus():
    assert normalize_phone("+998911110009") == "+998911110009"


def test_normalize_phone_strips_whitespace():
    assert normalize_phone("  998911110009  ") == "+998911110009"


def test_normalize_phone_strips_internal_separators():
    assert normalize_phone("+998 91 111-00-09") == "+998911110009"


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows
        self._filters = {}

    def select(self, *a, **k):
        return self

    def eq(self, column, value):
        self._filters[column] = value
        return self

    def execute(self):
        filtered = [r for r in self._rows if all(r.get(k) == v for k, v in self._filters.items())]
        return _FakeResult(filtered)


class _FakeClient:
    def __init__(self, rows):
        self._rows = rows

    def table(self, name):
        return _FakeQuery(self._rows)


def test_find_client_by_phone_found():
    fake = _FakeClient([{"id": "client-1", "tenant_id": "tenant-1", "phone": "+998911110009"}])
    assert find_client_by_phone(fake, "tenant-1", "998911110009") == "client-1"


def test_find_client_by_phone_not_found():
    fake = _FakeClient([{"id": "client-1", "tenant_id": "tenant-1", "phone": "+998911110009"}])
    assert find_client_by_phone(fake, "tenant-1", "998900000000") is None


def test_find_client_by_phone_does_not_leak_across_tenants():
    fake = _FakeClient([{"id": "client-1", "tenant_id": "tenant-1", "phone": "+998911110009"}])
    assert find_client_by_phone(fake, "tenant-2", "998911110009") is None
