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

    def neq(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) != value]
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
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


def test_gather_manager_context_resolves_name_from_email():
    fake = _FakeClient({
        "tenant_users": [{"tenant_id": "tenant-1", "email": "a@x.com", "name": "Азиз"}],
        "leads": [{"tenant_id": "tenant-1", "assigned_manager": "Азиз", "client_id": "c1", "stage": "matching"}],
        "calendar_events": [], "meeting_notes": [], "spravka_requests": [], "call_logs": [],
    })
    ctx = brain.gather_manager_context(fake, "tenant-1", "a@x.com")
    assert ctx["manager_name"] == "Азиз"
    assert len(ctx["leads"]) == 1


def test_gather_manager_context_unknown_email_returns_empty_shape():
    fake = _FakeClient({"tenant_users": []})
    ctx = brain.gather_manager_context(fake, "tenant-1", "nobody@x.com")
    assert ctx == {
        "manager_name": None, "leads": [], "calendar_events": [],
        "events_missing_notes": [], "pending_spravki": [], "recent_calls": [],
    }


def test_gather_manager_context_only_includes_events_for_this_managers_clients():
    fake = _FakeClient({
        "tenant_users": [{"tenant_id": "tenant-1", "email": "a@x.com", "name": "Азиз"}],
        "leads": [{"tenant_id": "tenant-1", "assigned_manager": "Азиз", "client_id": "c1", "stage": "matching"}],
        "calendar_events": [
            {"tenant_id": "tenant-1", "id": "e1", "client_id": "c1", "status": "confirmed", "event_at": "2026-08-10T10:00:00+00:00"},
            {"tenant_id": "tenant-1", "id": "e2", "client_id": "c2", "status": "confirmed", "event_at": "2026-08-10T10:00:00+00:00"},
        ],
        "meeting_notes": [], "spravka_requests": [], "call_logs": [],
    })
    ctx = brain.gather_manager_context(fake, "tenant-1", "a@x.com")
    assert len(ctx["calendar_events"]) == 1
    assert ctx["calendar_events"][0]["id"] == "e1"


def test_gather_manager_context_flags_past_confirmed_events_missing_notes():
    fake = _FakeClient({
        "tenant_users": [{"tenant_id": "tenant-1", "email": "a@x.com", "name": "Азиз"}],
        "leads": [{"tenant_id": "tenant-1", "assigned_manager": "Азиз", "client_id": "c1", "stage": "matching"}],
        "calendar_events": [
            {"tenant_id": "tenant-1", "id": "past-noted", "client_id": "c1", "status": "confirmed", "event_at": "2020-01-01T10:00:00+00:00"},
            {"tenant_id": "tenant-1", "id": "past-unnoted", "client_id": "c1", "status": "confirmed", "event_at": "2020-01-01T10:00:00+00:00"},
            {"tenant_id": "tenant-1", "id": "future", "client_id": "c1", "status": "confirmed", "event_at": "2099-01-01T10:00:00+00:00"},
        ],
        "meeting_notes": [{"tenant_id": "tenant-1", "calendar_event_id": "past-noted"}],
        "spravka_requests": [], "call_logs": [],
    })
    ctx = brain.gather_manager_context(fake, "tenant-1", "a@x.com")
    missing_ids = {e["id"] for e in ctx["events_missing_notes"]}
    assert missing_ids == {"past-unnoted"}


def test_gather_manager_context_pending_spravki_scoped_by_requested_by():
    fake = _FakeClient({
        "tenant_users": [{"tenant_id": "tenant-1", "email": "a@x.com", "name": "Азиз"}],
        "leads": [],
        "calendar_events": [], "meeting_notes": [],
        "spravka_requests": [
            {"tenant_id": "tenant-1", "requested_by": "Азиз", "status": "pending", "id": "s1"},
            {"tenant_id": "tenant-1", "requested_by": "Азиз", "status": "approved", "id": "s2"},
            {"tenant_id": "tenant-1", "requested_by": "Другой", "status": "pending", "id": "s3"},
        ],
        "call_logs": [],
    })
    ctx = brain.gather_manager_context(fake, "tenant-1", "a@x.com")
    assert len(ctx["pending_spravki"]) == 1
    assert ctx["pending_spravki"][0]["id"] == "s1"


def test_gather_manager_context_recent_calls_scoped_by_logged_by():
    fake = _FakeClient({
        "tenant_users": [{"tenant_id": "tenant-1", "email": "a@x.com", "name": "Азиз"}],
        "leads": [], "calendar_events": [], "meeting_notes": [], "spravka_requests": [],
        "call_logs": [
            {"tenant_id": "tenant-1", "logged_by": "a@x.com", "outcome": "no_answer", "created_at": "2026-08-05T00:00:00+00:00"},
            {"tenant_id": "tenant-1", "logged_by": "b@x.com", "outcome": "answered", "created_at": "2026-08-05T00:00:00+00:00"},
        ],
    })
    ctx = brain.gather_manager_context(fake, "tenant-1", "a@x.com")
    assert len(ctx["recent_calls"]) == 1
    assert ctx["recent_calls"][0]["logged_by"] == "a@x.com"


def test_gather_company_context_groups_leads_by_stage():
    fake = _FakeClient({
        "leads": [
            {"tenant_id": "tenant-1", "stage": "matching"},
            {"tenant_id": "tenant-1", "stage": "matching"},
            {"tenant_id": "tenant-1", "stage": "reserved"},
            {"tenant_id": "tenant-2", "stage": "reserved"},
        ],
        "buildings": [], "units": [], "spravka_requests": [], "calendar_events": [],
    })
    ctx = brain.gather_company_context(fake, "tenant-1")
    assert ctx["leads_by_stage"] == {"matching": 2, "reserved": 1}


def test_gather_company_context_building_stats_scoped_to_tenant():
    fake = _FakeClient({
        "leads": [],
        "buildings": [{"tenant_id": "tenant-1", "id": "b1", "name": "Milano"}],
        "units": [
            {"tenant_id": "tenant-1", "building_id": "b1", "status": "for_sale", "price_per_m2_usd": 1200},
            {"tenant_id": "tenant-1", "building_id": "b1", "status": "for_sale", "price_per_m2_usd": 1500},
            {"tenant_id": "tenant-1", "building_id": "b1", "status": "sold", "price_per_m2_usd": 1100},
        ],
        "spravka_requests": [], "calendar_events": [],
    })
    ctx = brain.gather_company_context(fake, "tenant-1")
    assert ctx["buildings"] == [{"name": "Milano", "total_units": 3, "for_sale": 2, "min_price_per_m2_usd": 1200}]


def test_gather_company_context_building_with_no_units_for_sale_has_null_price():
    fake = _FakeClient({
        "leads": [],
        "buildings": [{"tenant_id": "tenant-1", "id": "b1", "name": "Milano"}],
        "units": [{"tenant_id": "tenant-1", "building_id": "b1", "status": "sold", "price_per_m2_usd": 1100}],
        "spravka_requests": [], "calendar_events": [],
    })
    ctx = brain.gather_company_context(fake, "tenant-1")
    assert ctx["buildings"][0]["min_price_per_m2_usd"] is None


def test_gather_company_context_pending_spravki_tenant_wide_not_manager_scoped():
    fake = _FakeClient({
        "leads": [], "buildings": [], "units": [],
        "spravka_requests": [
            {"tenant_id": "tenant-1", "requested_by": "Азиз", "status": "pending", "id": "s1"},
            {"tenant_id": "tenant-1", "requested_by": "Другой", "status": "pending", "id": "s2"},
            {"tenant_id": "tenant-1", "requested_by": "Азиз", "status": "approved", "id": "s3"},
            {"tenant_id": "tenant-2", "requested_by": "Азиз", "status": "pending", "id": "s4"},
        ],
        "calendar_events": [],
    })
    ctx = brain.gather_company_context(fake, "tenant-1")
    assert {s["id"] for s in ctx["pending_spravki"]} == {"s1", "s2"}


def test_gather_company_context_today_events_excludes_past_and_future():
    from datetime import datetime
    from app.tenant_time import TENANT_TZ
    today_iso = datetime.now(TENANT_TZ).date().isoformat()
    fake = _FakeClient({
        "leads": [], "buildings": [], "units": [], "spravka_requests": [],
        "calendar_events": [
            {"tenant_id": "tenant-1", "id": "today", "status": "confirmed", "event_at": f"{today_iso}T10:00:00+00:00"},
            {"tenant_id": "tenant-1", "id": "past", "status": "confirmed", "event_at": "2020-01-01T10:00:00+00:00"},
            {"tenant_id": "tenant-1", "id": "future", "status": "confirmed", "event_at": "2099-01-01T10:00:00+00:00"},
            {"tenant_id": "tenant-1", "id": "today-dismissed", "status": "dismissed", "event_at": f"{today_iso}T11:00:00+00:00"},
        ],
    })
    ctx = brain.gather_company_context(fake, "tenant-1")
    assert {e["id"] for e in ctx["today_events"]} == {"today"}


def test_gather_company_context_today_events_uses_tenant_local_date_not_utc():
    """Regression test for the exact bug caught live (2026-08-10): a naive
    UTC "today" briefly disagrees with Tashkent's real calendar date every
    day (UTC 19:00-23:59 is already tomorrow in Tashkent, UTC+5). An event
    stored as UTC-tomorrow-morning is actually Tashkent-today-late-evening,
    and must still be included -- and vice versa, an event that's
    UTC-today-late-evening is already Tashkent-tomorrow and must be excluded."""
    from datetime import datetime, time, timezone
    from app.tenant_time import TENANT_TZ
    today_local = datetime.now(TENANT_TZ).date()

    # 23:00 Tashkent local time today -- as a raw UTC timestamp, this lands
    # on UTC-tomorrow whenever Tashkent local time is ahead of the UTC date
    # (i.e. it's currently past UTC midnight but before 05:00 UTC).
    event_local = datetime.combine(today_local, time(23, 0), tzinfo=TENANT_TZ)
    event_at_utc_iso = event_local.astimezone(timezone.utc).isoformat()
    fake = _FakeClient({
        "leads": [], "buildings": [], "units": [], "spravka_requests": [],
        "calendar_events": [
            {
                "tenant_id": "tenant-1", "id": "tashkent-today-late",
                "status": "confirmed", "event_at": event_at_utc_iso,
            },
        ],
    })

    ctx = brain.gather_company_context(fake, "tenant-1")

    assert {e["id"] for e in ctx["today_events"]} == {"tashkent-today-late"}
    assert ctx["today_events"][0]["event_at_local"] == "23:00"
