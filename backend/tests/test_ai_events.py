from app.services import ai_events


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, table_state, name):
        self._table_state = table_state
        self._name = name
        self._filters = {}
        self._insert_payload = None
        self._update_payload = None

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def eq(self, column, value):
        self._filters[column] = value
        return self

    def execute(self):
        rows = self._table_state.setdefault(self._name, [])
        if self._insert_payload is not None:
            rows.append(dict(self._insert_payload))
            return _FakeResult([self._insert_payload])
        if self._update_payload is not None:
            matched = [r for r in rows if all(r.get(k) == v for k, v in self._filters.items())]
            for r in matched:
                r.update(self._update_payload)
            return _FakeResult(matched)
        matched = [r for r in rows if all(r.get(k) == v for k, v in self._filters.items())]
        return _FakeResult(matched)


class _FakeClient:
    def __init__(self):
        self._state: dict[str, list] = {}

    def table(self, name):
        return _FakeQuery(self._state, name)


def test_log_ai_event_inserts_expected_row():
    fake = _FakeClient()
    ai_events.log_ai_event(
        fake, "tenant-1", "coaching_tip", "Совет: уточнить бюджет",
        client_id="client-1", manager_email="a@example.com",
    )
    rows = fake._state["ai_events"]
    assert len(rows) == 1
    assert rows[0]["tenant_id"] == "tenant-1"
    assert rows[0]["kind"] == "coaching_tip"
    assert rows[0]["summary"] == "Совет: уточнить бюджет"
    assert rows[0]["client_id"] == "client-1"
    assert rows[0]["manager_email"] == "a@example.com"
    assert rows[0]["related_id"] is None


def test_log_ai_event_defaults_optional_fields_to_none():
    fake = _FakeClient()
    ai_events.log_ai_event(fake, "tenant-1", "client_segments", "AI-сводка: 3 сегмента")
    row = fake._state["ai_events"][0]
    assert row["client_id"] is None
    assert row["manager_email"] is None
    assert row["related_id"] is None


def test_mark_event_outcome_updates_matching_row():
    fake = _FakeClient()
    ai_events.log_ai_event(
        fake, "tenant-1", "event_proposed", "Предложено событие",
        related_id="calendar-event-1",
    )
    ai_events.mark_event_outcome(fake, "tenant-1", "calendar-event-1", "confirmed")
    row = fake._state["ai_events"][0]
    assert row["outcome"] == "confirmed"


def test_mark_event_outcome_overwrites_previous_outcome():
    fake = _FakeClient()
    ai_events.log_ai_event(
        fake, "tenant-1", "event_proposed", "Предложено событие",
        related_id="calendar-event-1",
    )
    ai_events.mark_event_outcome(fake, "tenant-1", "calendar-event-1", "confirmed")
    ai_events.mark_event_outcome(fake, "tenant-1", "calendar-event-1", "dismissed")
    row = fake._state["ai_events"][0]
    assert row["outcome"] == "dismissed"


def test_mark_event_outcome_is_a_noop_when_nothing_matches():
    fake = _FakeClient()
    # No prior insert -- there's no ai_events row for this related_id.
    ai_events.mark_event_outcome(fake, "tenant-1", "no-such-id", "dismissed")
    assert fake._state.get("ai_events", []) == []
