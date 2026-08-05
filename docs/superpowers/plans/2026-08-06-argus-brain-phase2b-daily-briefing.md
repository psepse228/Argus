# Argus Brain — Phase 2b: daily briefing + meeting notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "На сегодня"'s fixed client-side rules with an AI-generated, cached, per-manager task list — the part of Argus Brain that actually directs the sales team ("говорит отделом продаж"), not just informs it — and add the manual meeting-note capture that feeds it real post-meeting outcomes.

**Architecture:** `gather_manager_context` (new `app/ai/brain.py` function, pure data assembly — leads, calendar events, pending справки, recent calls, past-meetings-missing-notes, all deterministic Postgres reads) feeds a new single-shot GPT-4o call (`app/ai/daily_briefing.py`) that ranks/phrases them into a task list, cached per manager per day (`daily_briefings` table) behind a new `GET/POST /api/brain/daily-briefing` pair so it's never regenerated on every page load. `TodayQueue.tsx` becomes a thin fetch-and-render of that endpoint instead of building its own list from four raw endpoints.

**Tech Stack:** FastAPI + Supabase (plain `def`, explicit `tenant_id` filtering), pytest with hand-rolled fake Supabase clients (matching `backend/tests/test_brain.py`/`test_ai_events.py`) plus a mocked-OpenAI-client test for the new AI module (matching `backend/tests/test_telegram_evaluator.py`), Next.js/React (no frontend test runner — verify via dev server).

**Scope note:** This is Phase 2b of `docs/superpowers/specs/2026-08-05-argus-brain-design.md` (already brainstormed/approved in that spec — no new brainstorm needed for this plan). Phase 3 (owner live summary) and Phase 4 (help chatbot) are the remaining phases from that same spec and get their own follow-up plans today.

---

### Task 1: Migration — `meeting_notes` table

**Files:**
- Create: `backend/supabase/migrations/0029_meeting_notes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Argus Brain Phase 2b: manual meeting-note capture. Telegram-derived
-- context is already automatic (telegram_conversations.summary), but an
-- in-person meeting/call has no text trail at all -- a manager logs what
-- happened themselves. This is the raw signal gather_manager_context uses
-- to build the "add a note for your past meeting" reminder in the daily
-- briefing (see docs/superpowers/specs/2026-08-05-argus-brain-design.md).
create table public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  calendar_event_id uuid references public.calendar_events(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  note text not null,
  logged_by text not null,
  created_at timestamptz not null default now()
);

create index on public.meeting_notes (tenant_id, calendar_event_id);
```

- [ ] **Step 2: Push the migration**

Run: `cd backend && npx.cmd supabase db push --linked`
Expected: `Applying migration 0029_meeting_notes.sql...` then `"message": "Finished supabase db push."`

- [ ] **Step 3: Verify live**

```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/meeting_notes?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: `[]`. Also run `cd backend && npx.cmd supabase migration list` and confirm `0029` shows a non-empty `remote` value.

- [ ] **Step 4: Commit**

```bash
cd backend
git add supabase/migrations/0029_meeting_notes.sql
git commit -m "feat: add meeting_notes table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — `daily_briefings` table

**Files:**
- Create: `backend/supabase/migrations/0030_daily_briefings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Argus Brain Phase 2b: caches one manager's AI-generated "На сегодня" list
-- so it's never regenerated on every page load -- one real generation per
-- manager per ~4h window (see app/routers/daily_briefing.py). items is the
-- model's already-ranked/phrased output, [{label, detail}, ...].
create table public.daily_briefings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_email text not null,
  briefing_date date not null,
  items jsonb not null,
  generated_at timestamptz not null default now(),
  unique (tenant_id, user_email, briefing_date)
);
```

- [ ] **Step 2: Push the migration**

Run: `cd backend && npx.cmd supabase db push --linked`
Expected: `Applying migration 0030_daily_briefings.sql...` then `"message": "Finished supabase db push."`

- [ ] **Step 3: Verify live**

```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/daily_briefings?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: `[]`. Also run `cd backend && npx.cmd supabase migration list` and confirm `0030` shows a non-empty `remote` value.

- [ ] **Step 4: Commit**

```bash
cd backend
git add supabase/migrations/0030_daily_briefings.sql
git commit -m "feat: add daily_briefings table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `gather_manager_context` in `app/ai/brain.py`

**Files:**
- Modify: `backend/app/ai/brain.py`
- Modify: `backend/tests/test_brain.py`

- [ ] **Step 1: Read the current `backend/app/ai/brain.py` and `backend/tests/test_brain.py`** to confirm their exact content before editing (both already exist from Phase 0+1 -- `gather_client_context` and its 5 tests).

- [ ] **Step 2: Write the failing tests**

Add these to the end of `backend/tests/test_brain.py` (keep the existing `gather_client_context` tests and the `_FakeClient`/`_FakeQuery`/`_FakeResult` classes already in that file, reuse them):

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_brain.py -v`
Expected: FAIL with `AttributeError: module 'app.ai.brain' has no attribute 'gather_manager_context'`

- [ ] **Step 4: Write the implementation**

Add this function to `backend/app/ai/brain.py` (below the existing `gather_client_context`, keep that function unchanged):

```python
def gather_manager_context(client, tenant_id: str, manager_email: str) -> dict:
    """Deterministic fact set behind one manager's daily briefing (Phase 2b):
    their leads, calendar events tied to their clients, справки they've
    requested that are still pending, their recent call outcomes, and any
    past confirmed meeting that still needs a note. Pure data assembly, no
    AI, no judgment -- app/ai/daily_briefing.py does the prioritization and
    phrasing on top of this.

    leads.assigned_manager and spravka_requests.requested_by both store a
    NAME (matching tenant_users.name), not the login email used everywhere
    else in Argus Brain (ai_events, call_logs, telegram_business_connections
    all key by email) -- resolve through tenant_users first rather than
    assuming they're the same identifier.
    """
    user_row = (
        client.table("tenant_users").select("name")
        .eq("tenant_id", tenant_id).eq("email", manager_email).execute().data
    )
    if not user_row:
        return {
            "manager_name": None, "leads": [], "calendar_events": [],
            "events_missing_notes": [], "pending_spravki": [], "recent_calls": [],
        }
    manager_name = user_row[0]["name"]

    leads = (
        client.table("leads").select("*")
        .eq("tenant_id", tenant_id).eq("assigned_manager", manager_name).execute().data
    )
    client_ids = {l["client_id"] for l in leads if l.get("client_id")}

    all_events = (
        client.table("calendar_events").select("*, clients(name, phone)")
        .eq("tenant_id", tenant_id).neq("status", "dismissed").execute().data
    )
    manager_events = [e for e in all_events if e.get("client_id") in client_ids]

    notes = client.table("meeting_notes").select("calendar_event_id").eq("tenant_id", tenant_id).execute().data
    noted_event_ids = {n["calendar_event_id"] for n in notes}
    now_iso = datetime.now(timezone.utc).isoformat()
    events_missing_notes = [
        e for e in manager_events
        if e["status"] == "confirmed" and e["event_at"] < now_iso and e["id"] not in noted_event_ids
    ]

    pending_spravki = (
        client.table("spravka_requests")
        .select("*, units(unit_number, buildings(name))")
        .eq("tenant_id", tenant_id).eq("requested_by", manager_name).eq("status", "pending").execute().data
    )

    recent_calls = (
        client.table("call_logs").select("*")
        .eq("tenant_id", tenant_id).eq("logged_by", manager_email)
        .order("created_at", desc=True).limit(20).execute().data
    )

    return {
        "manager_name": manager_name,
        "leads": leads,
        "calendar_events": manager_events,
        "events_missing_notes": events_missing_notes,
        "pending_spravki": pending_spravki,
        "recent_calls": recent_calls,
    }
```

At the top of `backend/app/ai/brain.py`, add (if not already present -- check the current imports first, this file may currently have no imports at all since `gather_client_context` didn't need any):

```python
from datetime import datetime, timezone
```

- [ ] **Step 5: Update the fake test client to support `.order()`/`.limit()` and multiple tables**

The existing `_FakeClient`/`_FakeQuery` in `test_brain.py` (from Phase 0+1) already supports multiple named tables and chained `.eq()`. Check whether it already supports `.order()` and `.limit()` as no-op passthroughs (needed by `gather_manager_context`'s `recent_calls` query) -- if not, add these two methods to `_FakeQuery`:

```python
    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self
```

(Place them alongside the existing `.eq()` method. If `_FakeQuery` already has these from an earlier phase, skip this -- don't duplicate.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_brain.py -v`
Expected: PASS (11 passed -- 5 existing `gather_client_context` tests + 6 new `gather_manager_context` tests)

- [ ] **Step 7: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all pass (should be 35 total: 29 existing + 6 new).

- [ ] **Step 8: Commit**

```bash
cd backend
git add app/ai/brain.py tests/test_brain.py
git commit -m "feat: add gather_manager_context to Argus Brain

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `app/ai/daily_briefing.py` — AI module

**Files:**
- Create: `backend/app/ai/daily_briefing.py`
- Test: `backend/tests/test_daily_briefing.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_daily_briefing.py
import pytest


def test_generate_daily_briefing_parses_response(monkeypatch):
    class FakeMessage:
        content = '{"items": [{"label": "Позвонить +998911110002", "detail": "Резерв истекает завтра"}]}'

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    import app.ai.daily_briefing as mod
    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())

    result = mod.generate_daily_briefing({"leads": [], "calendar_events": []})

    assert result == [{"label": "Позвонить +998911110002", "detail": "Резерв истекает завтра"}]
    assert captured["model"] == "gpt-4o"
    assert captured["messages"][0]["role"] == "system"
    assert captured["messages"][1]["role"] == "user"


def test_generate_daily_briefing_propagates_openai_failure(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            raise RuntimeError("boom")

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    import app.ai.daily_briefing as mod
    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())

    with pytest.raises(RuntimeError, match="boom"):
        mod.generate_daily_briefing({"leads": []})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_daily_briefing.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.ai.daily_briefing'`

- [ ] **Step 3: Write the implementation**

```python
# backend/app/ai/daily_briefing.py
"""Single-shot GPT-4o call that turns gather_manager_context's deterministic
facts (backend/app/ai/brain.py) into a prioritized, phrased task list for one
manager's "На сегодня" -- the part of Argus Brain that actually directs the
sales team, not just informs it. Same discipline as telegram_evaluator.py/
client_context.py: never invent a fact that isn't in the input; the model's
job is to rank, phrase, and add judgment calls grounded in what's actually
there (e.g. "this lead looks ready but hasn't been contacted in 2 days"),
not to hallucinate a lead/event/справка that doesn't exist.
"""
import json
import logging
import os
from datetime import datetime, timezone

from openai import OpenAI

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


_SYSTEM_PROMPT = """Ты помогаешь менеджеру по продажам недвижимости понять, что делать сегодня.
На входе -- JSON со всеми его лидами (стадия, дата последнего изменения), календарными событиями,
справками, которые он подал и которые ещё не одобрены/отклонены, недавними звонками (с исходом --
взял/не взял/отложил) и встречами, у которых ещё нет заметки о том, как они прошли.

Составь короткий список конкретных задач на сегодня (3-7 пунктов), отсортированный по важности.
Для каждой задачи дай: label (короткое действие, например "Позвонить +998911110002") и detail
(почему, одна фраза, например "Резерв истекает завтра" или "Не брал трубку вчера, попробуй снова").

Правила:
- Используй ТОЛЬКО факты из входных данных. Никогда не выдумывай лида, событие или звонок, которого
  нет в списке.
- Резерв (стадия "reserved"), который висит без движения больше 3 дней -- всегда высокий приоритет.
- Событие сегодня или завтра -- напоминание подготовиться.
- Событие из events_missing_notes -- напомни добавить заметку о том, как оно прошло.
- Лид без первого контакта дольше 24 часов, или с последним звонком no_answer -- напомни перезвонить.
- Если реальных срочных задач нет, верни пустой список items -- не выдумывай задачи ради того, чтобы
  список не был пустым.
Сегодняшняя дата: {today}."""

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "daily_briefing",
        "schema": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "detail": {"type": "string"},
                        },
                        "required": ["label", "detail"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["items"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def generate_daily_briefing(facts: dict) -> list[dict]:
    """facts: gather_manager_context's return dict. Returns a list of
    {"label": str, "detail": str} dicts, already prioritized -- the display
    order IS the model's ranking, no further client-side sorting.

    No try/except here, same reasoning as the other app/ai single-shot
    callers (telegram_evaluator.py, client_context.py) -- best-effort
    handling belongs to the caller (the daily-briefing router)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d (%A)")
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT.format(today=today)},
        {"role": "user", "content": json.dumps(facts, ensure_ascii=False, default=str)},
    ]
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
        return json.loads(resp.choices[0].message.content)["items"]
    except Exception:
        logger.exception("Daily briefing generation failed")
        raise
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_daily_briefing.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all pass (37 total).

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/ai/daily_briefing.py tests/test_daily_briefing.py
git commit -m "feat: add generate_daily_briefing AI module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Meeting-note endpoint + `has_meeting_note` on `GET /api/calendar`

**Files:**
- Modify: `backend/app/routers/calendar.py`

- [ ] **Step 1: Read the current `backend/app/routers/calendar.py`** to confirm its exact content before editing.

- [ ] **Step 2: Enrich `list_events` with `has_meeting_note`**

Current code:

```python
@router.get("")
def list_events(user=Depends(get_current_user)):
    client = get_service_client()
    return (
        client.table("calendar_events").select("*, clients(name, phone)")
        .eq("tenant_id", user.tenant_id).neq("status", "dismissed")
        .order("event_at").execute().data
    )
```

Replace with:

```python
@router.get("")
def list_events(user=Depends(get_current_user)):
    client = get_service_client()
    events = (
        client.table("calendar_events").select("*, clients(name, phone)")
        .eq("tenant_id", user.tenant_id).neq("status", "dismissed")
        .order("event_at").execute().data
    )
    notes = client.table("meeting_notes").select("calendar_event_id").eq("tenant_id", user.tenant_id).execute().data
    noted_ids = {n["calendar_event_id"] for n in notes}
    for e in events:
        e["has_meeting_note"] = e["id"] in noted_ids
    return events
```

- [ ] **Step 3: Add the meeting-note endpoint**

Add this at the end of `backend/app/routers/calendar.py` (after the existing `dismiss_event` function):

```python
class MeetingNoteCreate(BaseModel):
    note: str


@router.post("/{event_id}/meeting-note")
def add_meeting_note(event_id: str, body: MeetingNoteCreate, user=Depends(get_current_user)):
    client = get_service_client()
    event = (
        client.table("calendar_events").select("id, client_id")
        .eq("id", event_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    inserted = client.table("meeting_notes").insert({
        "tenant_id": user.tenant_id, "calendar_event_id": event_id,
        "client_id": event[0].get("client_id"), "note": body.note, "logged_by": user.email,
    }).execute().data
    return inserted[0]
```

(`BaseModel` is already imported in this file for `CalendarEventCreate`/`CalendarEventUpdate` -- no new import needed.)

- [ ] **Step 4: Verify the backend imports cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0.

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all pass. (No dedicated test file for this router -- consistent with this codebase's convention.)

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/routers/calendar.py
git commit -m "feat: add meeting-note endpoint + has_meeting_note flag

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `GET/POST /api/brain/daily-briefing` — new router

**Files:**
- Create: `backend/app/routers/daily_briefing.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the router**

```python
"""Argus Brain Phase 2b: the cached, AI-prioritized "На сегодня" list.
Generated at most once per manager per ~4h window (see _is_stale below) --
never on every page load, matching the cost-control decision in
docs/superpowers/specs/2026-08-05-argus-brain-design.md. GET returns the
cached copy if it's fresh, regenerating only if stale or missing; POST
/refresh always regenerates (the explicit "Обновить" button).
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.ai.brain import gather_manager_context
from app.ai.daily_briefing import generate_daily_briefing
from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/brain")

_STALE_AFTER = timedelta(hours=4)


def _regenerate(client, tenant_id: str, user_email: str, today: str) -> list[dict]:
    facts = gather_manager_context(client, tenant_id, user_email)
    try:
        items = generate_daily_briefing(facts)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось обновить список задач — попробуйте ещё раз")
    payload = {
        "tenant_id": tenant_id, "user_email": user_email, "briefing_date": today,
        "items": items, "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    existing = (
        client.table("daily_briefings").select("id")
        .eq("tenant_id", tenant_id).eq("user_email", user_email).eq("briefing_date", today)
        .execute().data
    )
    if existing:
        client.table("daily_briefings").update(payload).eq("id", existing[0]["id"]).execute()
    else:
        client.table("daily_briefings").insert(payload).execute()
    return items


@router.get("/daily-briefing")
def get_daily_briefing(user=Depends(get_current_user)):
    client = get_service_client()
    today = datetime.now(timezone.utc).date().isoformat()
    cached = (
        client.table("daily_briefings").select("*")
        .eq("tenant_id", user.tenant_id).eq("user_email", user.email).eq("briefing_date", today)
        .execute().data
    )
    if cached:
        generated_at = datetime.fromisoformat(cached[0]["generated_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - generated_at < _STALE_AFTER:
            return cached[0]["items"]
    return _regenerate(client, user.tenant_id, user.email, today)


@router.post("/daily-briefing/refresh")
def refresh_daily_briefing(user=Depends(get_current_user)):
    client = get_service_client()
    today = datetime.now(timezone.utc).date().isoformat()
    return _regenerate(client, user.tenant_id, user.email, today)
```

- [ ] **Step 2: Register the router in `main.py`**

Find:

```python
from app.routers import auth_google, units, leads, spravka, assistant, pricing, analytics, clients, conversations, payments, workspace, telegram_business, calendar, call_logs, ai_events
```

Change to:

```python
from app.routers import auth_google, units, leads, spravka, assistant, pricing, analytics, clients, conversations, payments, workspace, telegram_business, calendar, call_logs, ai_events, daily_briefing
```

Find:

```python
app.include_router(ai_events.router)
```

Change to:

```python
app.include_router(ai_events.router)
app.include_router(daily_briefing.router)
```

- [ ] **Step 3: Verify the backend imports cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0.

- [ ] **Step 4: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all pass. (No dedicated test file for this router -- the two functions it composes, `gather_manager_context` and `generate_daily_briefing`, already have direct unit tests from Tasks 3-4; this router is thin glue + caching logic verified manually in Task 11.)

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/routers/daily_briefing.py app/main.py
git commit -m "feat: add GET/POST /api/brain/daily-briefing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend types

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add `DailyBriefingItem` and extend `CalendarEvent`**

Add at the very end of `frontend/src/lib/types.ts` (after the existing `AiEvent` type):

```typescript

export type DailyBriefingItem = { label: string; detail: string };
```

Then find the `CalendarEvent` type:

```typescript
export type CalendarEvent = {
  id: string;
  client_id: string | null;
  telegram_conversation_id: string | null;
  title: string;
  event_at: string;
  note: string | null;
  source: "manual" | "monitor";
  status: "proposed" | "confirmed" | "dismissed";
  created_by: string | null;
  created_at: string;
  clients?: { name: string | null; phone: string } | null;
};
```

Replace with (adds `has_meeting_note`):

```typescript
export type CalendarEvent = {
  id: string;
  client_id: string | null;
  telegram_conversation_id: string | null;
  title: string;
  event_at: string;
  note: string | null;
  source: "manual" | "monitor";
  status: "proposed" | "confirmed" | "dismissed";
  created_by: string | null;
  created_at: string;
  clients?: { name: string | null; phone: string } | null;
  has_meeting_note?: boolean;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/lib/types.ts
git commit -m "feat: add DailyBriefingItem type, CalendarEvent.has_meeting_note

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `api.ts` — daily briefing + meeting-note functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the `DailyBriefingItem` import**

Current code at the top of `frontend/src/lib/api.ts`:

```typescript
import { AiEvent, CalendarEvent, Client, ClientSegment, TelegramConversation, TelegramMessage } from "./types";
```

Change to:

```typescript
import { AiEvent, CalendarEvent, Client, ClientSegment, DailyBriefingItem, TelegramConversation, TelegramMessage } from "./types";
```

- [ ] **Step 2: Add the three functions**

Find the end of the `api` object:

```typescript
  aiEvents: (params?: { kind?: string; client_id?: string }): Promise<AiEvent[]> => {
    const query = new URLSearchParams();
    if (params?.kind) query.set("kind", params.kind);
    if (params?.client_id) query.set("client_id", params.client_id);
    const qs = query.toString();
    return request(`/api/ai-events${qs ? `?${qs}` : ""}`);
  },
};
```

Change to:

```typescript
  aiEvents: (params?: { kind?: string; client_id?: string }): Promise<AiEvent[]> => {
    const query = new URLSearchParams();
    if (params?.kind) query.set("kind", params.kind);
    if (params?.client_id) query.set("client_id", params.client_id);
    const qs = query.toString();
    return request(`/api/ai-events${qs ? `?${qs}` : ""}`);
  },

  dailyBriefing: (): Promise<DailyBriefingItem[]> => request("/api/brain/daily-briefing"),
  refreshDailyBriefing: (): Promise<DailyBriefingItem[]> =>
    request("/api/brain/daily-briefing/refresh", { method: "POST" }),
  addMeetingNote: (eventId: string, note: string) =>
    request(`/api/calendar/${eventId}/meeting-note`, { method: "POST", body: JSON.stringify({ note }) }),
};
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/lib/api.ts
git commit -m "feat: add api.dailyBriefing, refreshDailyBriefing, addMeetingNote

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `CalendarPanel.tsx` — "Как прошло?" meeting-note prompt

**Files:**
- Modify: `frontend/src/components/CalendarPanel.tsx`

- [ ] **Step 1: Add note-editing state**

Current code near the top of the component:

```tsx
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());
```

Change to:

```tsx
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
```

- [ ] **Step 2: Add the save-note handler**

Right after the existing `addManual` function:

```tsx
  async function addManual() {
    if (!newTitle.trim() || !newAt) return;
    setActionError("");
    try {
      await api.createCalendarEvent({ title: newTitle.trim(), event_at: new Date(newAt).toISOString() });
      setNewTitle(""); setNewAt(""); setShowAddForm(false);
      await refresh();
    } catch (e: any) {
      setActionError(e.message);
    }
  }
```

Add right after it:

```tsx
  async function saveMeetingNote(eventId: string) {
    if (!noteText.trim()) return;
    setActionError("");
    try {
      await api.addMeetingNote(eventId, noteText.trim());
      setNoteEditingId(null); setNoteText("");
      await refresh();
    } catch (e: any) {
      setActionError(e.message);
    }
  }
```

- [ ] **Step 3: Add the prompt to the day-detail event rows**

Current code (the day-detail list, near the end of the component):

```tsx
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dayEvents.map((ev) => (
              <div key={ev.id} className="glass-panel" style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text)" }}>{ev.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>
                    {fmtTime(ev.event_at)}
                    {ev.clients && <> · <span onClick={() => ev.client_id && onOpenClient?.(ev.client_id)} className={ev.client_id ? "press" : undefined} style={{ cursor: ev.client_id ? "pointer" : "default", color: ev.client_id ? "var(--v-accent)" : undefined }}>{ev.clients.name || ev.clients.phone}</span></>}
                  </div>
                </div>
                <span style={{ fontSize: 10, color: "var(--color-text-faint)" }}>{ev.source === "monitor" ? "из переписки" : "вручную"}</span>
              </div>
            ))}
          </div>
        );
```

Replace with:

```tsx
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dayEvents.map((ev) => {
              const needsNote = ev.status === "confirmed" && new Date(ev.event_at) < new Date() && !ev.has_meeting_note;
              return (
                <div key={ev.id} className="glass-panel" style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text)" }}>{ev.title}</div>
                      <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>
                        {fmtTime(ev.event_at)}
                        {ev.clients && <> · <span onClick={() => ev.client_id && onOpenClient?.(ev.client_id)} className={ev.client_id ? "press" : undefined} style={{ cursor: ev.client_id ? "pointer" : "default", color: ev.client_id ? "var(--v-accent)" : undefined }}>{ev.clients.name || ev.clients.phone}</span></>}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: "var(--color-text-faint)" }}>{ev.source === "monitor" ? "из переписки" : "вручную"}</span>
                  </div>
                  {needsNote && (
                    noteEditingId === ev.id ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Как прошло?"
                          style={{ flex: 1, padding: "7px 10px", borderRadius: 8, background: "var(--surface-04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 12.5 }}
                        />
                        <button onClick={() => saveMeetingNote(ev.id)} className="press" style={primaryBtnStyle}>Сохранить</button>
                        <button onClick={() => { setNoteEditingId(null); setNoteText(""); }} className="press" style={ghostBtnStyle}>Отмена</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setNoteEditingId(ev.id); setNoteText(""); }}
                        className="press" style={{ ...ghostBtnStyle, alignSelf: "flex-start" }}
                      >
                        Как прошло? →
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        );
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/components/CalendarPanel.tsx
git commit -m "feat: add meeting-note prompt to past confirmed events

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `TodayQueue.tsx` — full rewrite to consume the daily briefing

**Files:**
- Modify: `frontend/src/components/TodayQueue.tsx`
- Modify: `frontend/src/components/AssistantPanel.tsx`

- [ ] **Step 1: Replace the entire content of `frontend/src/components/TodayQueue.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DailyBriefingItem } from "@/lib/types";

/** Argus Brain Phase 2b: this used to build its own list from four raw
 * endpoints (leads/справки/clients/calendar) with fixed client-side rules.
 * Now it's a thin fetch-and-render of the cached, AI-prioritized
 * daily-briefing endpoint (backend/app/routers/daily_briefing.py) --
 * gather_manager_context supplies the deterministic facts, generate_daily_briefing
 * ranks/phrases them, cached per manager per day so this never triggers a
 * fresh OpenAI call on every page load. */
export function TodayQueue({ isBoss }: { isBoss: boolean }) {
  const [items, setItems] = useState<DailyBriefingItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dailyBriefing().then(setItems).catch((e: any) => { setError(`Не удалось загрузить список: ${e.message}`); setItems([]); });
  }, []);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      setItems(await api.refreshDailyBriefing());
    } catch (e: any) {
      setError(`Не удалось обновить: ${e.message}`);
    } finally {
      setRefreshing(false);
    }
  }

  if (items === null) return null;

  return (
    <div className="glass-panel" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text)" }}>На сегодня</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {items.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)", borderRadius: 99, padding: "2px 9px" }}>
              {items.length}
            </span>
          )}
          <button
            onClick={refresh} disabled={refreshing} className="press"
            style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-faint)", background: "none", border: "none", cursor: "pointer", opacity: refreshing ? 0.5 : 1 }}
          >
            {refreshing ? "…" : "Обновить"}
          </button>
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-faint)", margin: "0 0 12px" }}>
        AI-приоритеты на сегодня — из лидов, справок, календаря и звонков.
      </p>
      {error && <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 10 }}>{error}</div>}
      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Пусто — ничего срочного нет.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: "12px 20px" }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, paddingBottom: 10, borderBottom: "1px solid var(--color-hairline-soft)", minWidth: 0 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--v-accent)", flexShrink: 0, marginTop: 5 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</div>
                <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

(`isBoss` is kept as a prop for now even though this rewrite doesn't use it -- the daily-briefing endpoint scopes by the authenticated manager automatically, not by an `isBoss` flag passed down. Keeping the prop avoids an unrelated signature change to `AssistantPanel.tsx` beyond what Step 2 needs. If TypeScript flags it as unused, that's expected and fine -- an unused prop isn't a type error.)

- [ ] **Step 2: Confirm `AssistantPanel.tsx`'s call site still matches**

Read `frontend/src/components/AssistantPanel.tsx` and confirm the line `{tab === "home" && <TodayQueue isBoss={isBoss} />}` (or wherever `TodayQueue` is rendered) still compiles as-is -- it should, since the prop signature is unchanged. No edit needed here; this step is a confirmation, not a change.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/TodayQueue.tsx
git commit -m "feat: rewrite TodayQueue to consume the AI daily briefing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Manual verification pass + deploy

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all pass (37 total: 29 existing + 6 `gather_manager_context` + 2 `generate_daily_briefing`).

- [ ] **Step 2: Run the frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Start both dev servers fresh** (kill and restart, absolute `.venv` python path for the backend)

```bash
# backend, from backend/
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8010
```
```bash
# frontend, from frontend/
npm run dev
```

- [ ] **Step 4: Confirm "На сегодня" generates and caches**

Open the Обзор/Ассистент home screen (dev-bypass login). Confirm "На сегодня" loads a real AI-generated list (not the old rule-based one) -- items should read as phrased sentences, not raw signal dumps. Reload the page and confirm the SAME list appears instantly (no multi-second OpenAI wait) -- this proves the cache is working. Click "Обновить" and confirm it regenerates (a few seconds' wait, list may change).

Verify the cache row directly:
```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/daily_briefings?select=*&order=generated_at.desc&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: one row with a real `items` array and a recent `generated_at`.

- [ ] **Step 5: Confirm the meeting-note prompt**

If a confirmed calendar event exists with `event_at` in the past, open Календарь, select that day, and confirm a "Как прошло? →" prompt appears on that event (and NOT on future events or events that already have a note). Click it, type a note, save, and confirm:
```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/meeting_notes?select=*&order=created_at.desc&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: your note, with the right `calendar_event_id`/`client_id`/`logged_by`. Reopen the same day and confirm the prompt is now gone for that event (has_meeting_note flips to true).

If no qualifying past confirmed event exists to test with, create one manually (add a calendar event with a past date/time via the existing "+ Добавить событие" form, no way to backdate through the UI -- note this as a gap in your verification report rather than skipping the check silently; alternatively, insert a test row directly via curl with a past `event_at` and `status=confirmed`, verify, then delete it).

- [ ] **Step 6: Push to trigger the Railway deploy**

```bash
git push origin main
```

Then poll `railway status` until both services show `● Online`, and check `railway logs` for any startup errors (particularly import errors from the new `daily_briefing` router registration, or a `42P01`/`42703` from the two new tables if a migration didn't actually apply).
