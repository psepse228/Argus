# Журнал AI (ai_events) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a permanent, role-scoped audit log ("Журнал AI") of everything Argus's AI has actually done — coaching tips, proposed calendar events (with accept/reject outcome), sent Telegram drafts, client context-summary refreshes, and AI-сводка runs — surfaced as a new nav section, so a manager can see what the AI told them and why, and the boss can see it across the whole tenant.

**Architecture:** One new append-only table (`ai_events`) plus a tiny two-function service module (`app/services/ai_events.py`) that every existing AI call-site calls *after* it's already produced its result — logging only, zero new OpenAI calls. One new read endpoint (`GET /api/ai-events`, tenant + role scoped) and one new frontend panel wired into the existing nav-section pattern.

**Tech Stack:** FastAPI + Supabase (plain `def`, explicit `tenant_id` filtering), pytest with hand-rolled fake Supabase clients (matching `backend/tests/test_matching.py`/`test_brain.py`), Next.js/React (no frontend test runner in this repo — verify via dev server, matching this repo's established convention).

**Scope note:** This is the full `docs/superpowers/specs/2026-08-06-ai-events-journal-design.md` spec — unlike the two-part Argus Brain phases, this one is small enough (one table, 5 write points, 1 read endpoint, 1 panel) to ship as a single plan.

---

### Task 1: Migration — `ai_events` table

**Files:**
- Create: `backend/supabase/migrations/0028_ai_events.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Журнал AI (Argus Brain transparency): an append-only log every AI
-- call-site writes to AFTER it's already produced its result -- no new
-- OpenAI calls happen because of this table, it's pure logging. Addresses
-- the gap flagged directly by the user 2026-08-06: Argus Brain was built as
-- invisible plumbing (advisor panel, "На сегодня", owner "Сводка"), but a
-- manager being "directed" by something with no visible track record
-- doesn't build trust. See docs/superpowers/specs/2026-08-06-ai-events-journal-design.md.
create table public.ai_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in (
    'coaching_tip', 'event_proposed', 'draft_sent', 'context_summary', 'client_segments'
  )),
  client_id uuid references public.clients(id) on delete set null,
  manager_email text,
  summary text not null,
  outcome text check (outcome in ('confirmed', 'dismissed')),
  related_id uuid,
  created_at timestamptz not null default now()
);

create index on public.ai_events (tenant_id, created_at desc);
create index on public.ai_events (tenant_id, manager_email);
```

- [ ] **Step 2: Push the migration**

Run: `cd backend && npx.cmd supabase db push --linked`
Expected: `Applying migration 0028_ai_events.sql...` then `"message": "Finished supabase db push."`

- [ ] **Step 3: Verify live**

```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/ai_events?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: `[]`. Also run `cd backend && npx.cmd supabase migration list` and confirm `0028` shows a non-empty `remote` value.

- [ ] **Step 4: Commit**

```bash
cd backend
git add supabase/migrations/0028_ai_events.sql
git commit -m "feat: add ai_events table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `app/services/ai_events.py` — logging helpers

**Files:**
- Create: `backend/app/services/ai_events.py`
- Test: `backend/tests/test_ai_events.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_ai_events.py
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


def test_mark_event_outcome_is_a_noop_when_nothing_matches():
    fake = _FakeClient()
    # No prior insert -- there's no ai_events row for this related_id.
    ai_events.mark_event_outcome(fake, "tenant-1", "no-such-id", "dismissed")
    assert fake._state.get("ai_events", []) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_ai_events.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.ai_events'`

- [ ] **Step 3: Write the implementation**

```python
# backend/app/services/ai_events.py
"""Журнал AI (ai_events) -- an append-only log written to AFTER an existing
AI call-site has already produced its result. No new OpenAI calls happen
here; this is pure logging, addressing the transparency gap in Argus Brain
(see docs/superpowers/specs/2026-08-06-ai-events-journal-design.md) -- a
manager being "directed" by the AI with no visible track record doesn't
build trust. Every call here is meant to be wrapped best-effort by its
caller: a failure to log must never break the real feature that already
happened (matches this codebase's established convention, e.g. the
auto-greeting/event-proposal code in telegram_business.py).
"""


def log_ai_event(
    client, tenant_id: str, kind: str, summary: str,
    client_id: str | None = None, manager_email: str | None = None,
    related_id: str | None = None,
) -> None:
    client.table("ai_events").insert({
        "tenant_id": tenant_id, "kind": kind, "summary": summary,
        "client_id": client_id, "manager_email": manager_email, "related_id": related_id,
    }).execute()


def mark_event_outcome(client, tenant_id: str, related_id: str, outcome: str) -> None:
    """Best-effort -- a missing journal row (e.g. a manually-created calendar
    event that was never an AI proposal) is not an error, just a no-op."""
    client.table("ai_events").update({"outcome": outcome}).eq("tenant_id", tenant_id).eq("related_id", related_id).execute()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_ai_events.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/services/ai_events.py tests/test_ai_events.py
git commit -m "feat: add ai_events logging helpers (log_ai_event, mark_event_outcome)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Log `coaching_tip` and `event_proposed` from the Telegram webhook

**Files:**
- Modify: `backend/app/routers/telegram_business.py`

- [ ] **Step 1: Add the import**

Current code at the top of `backend/app/routers/telegram_business.py`:

```python
from app.ai.telegram_evaluator import evaluate_conversation
from app.ai.functions import get_units, get_payment_plan_rates
```

Change to:

```python
from app.ai.telegram_evaluator import evaluate_conversation
from app.ai.functions import get_units, get_payment_plan_rates
from app.services.ai_events import log_ai_event
```

- [ ] **Step 2: Log `coaching_tip` right after it's persisted**

Current code:

```python
            evaluation = evaluate_conversation(history, inventory_context)
            client.table("telegram_conversations").update({
                "summary": evaluation["summary"], "next_step_suggestion": evaluation["next_step"],
                "draft_reply": evaluation["draft_reply"], "coaching_tip": evaluation["coaching_tip"],
                "draft_generated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", conversation["id"]).execute()

            # AI "monitor" (Day 4): propose, never auto-confirm -- same
```

Replace with:

```python
            evaluation = evaluate_conversation(history, inventory_context)
            client.table("telegram_conversations").update({
                "summary": evaluation["summary"], "next_step_suggestion": evaluation["next_step"],
                "draft_reply": evaluation["draft_reply"], "coaching_tip": evaluation["coaching_tip"],
                "draft_generated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", conversation["id"]).execute()

            if evaluation.get("coaching_tip"):
                try:
                    log_ai_event(
                        client, connection["tenant_id"], "coaching_tip", evaluation["coaching_tip"],
                        client_id=conversation.get("client_id"), manager_email=connection["manager_email"],
                    )
                except Exception:
                    pass  # best-effort -- a failed journal write must not break message evaluation

            # AI "monitor" (Day 4): propose, never auto-confirm -- same
```

- [ ] **Step 3: Log `event_proposed` right after the proposal is inserted**

Current code:

```python
                    if not existing_proposal:
                        client.table("calendar_events").insert({
                            "tenant_id": connection["tenant_id"],
                            "client_id": conversation.get("client_id"),
                            "telegram_conversation_id": conversation["id"],
                            "title": evaluation.get("event_title") or "Встреча с клиентом",
                            "event_at": event_at.isoformat(),
                            "note": evaluation.get("event_note"),
                            "source": "monitor", "status": "proposed",
                        }).execute()
                except (ValueError, KeyError):
                    pass  # unparseable event_at -- skip the proposal rather than guess
```

Replace with:

```python
                    if not existing_proposal:
                        inserted_event = client.table("calendar_events").insert({
                            "tenant_id": connection["tenant_id"],
                            "client_id": conversation.get("client_id"),
                            "telegram_conversation_id": conversation["id"],
                            "title": evaluation.get("event_title") or "Встреча с клиентом",
                            "event_at": event_at.isoformat(),
                            "note": evaluation.get("event_note"),
                            "source": "monitor", "status": "proposed",
                        }).execute().data[0]
                        try:
                            log_ai_event(
                                client, connection["tenant_id"], "event_proposed",
                                f"Предложено событие: {inserted_event['title']}",
                                client_id=conversation.get("client_id"), manager_email=connection["manager_email"],
                                related_id=inserted_event["id"],
                            )
                        except Exception:
                            pass  # best-effort -- a failed journal write must not break the proposal itself
                except (ValueError, KeyError):
                    pass  # unparseable event_at -- skip the proposal rather than guess
```

- [ ] **Step 4: Verify the backend imports cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0.

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all pass (no dedicated test file for the webhook itself -- this codebase verifies it manually, matching the existing convention; `test_ai_events.py`'s new tests cover the logging helper's own logic).

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/routers/telegram_business.py
git commit -m "feat: log coaching_tip and event_proposed to the AI journal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Log `draft_sent` when a manager sends a Telegram reply

**Files:**
- Modify: `backend/app/routers/telegram_business.py`

- [ ] **Step 1: Log after a successful send**

Current code:

```python
@api_router.post("/conversations/{conversation_id}/send")
def send_reply(conversation_id: str, body: SendBody, user=Depends(get_current_user)):
    client = get_service_client()
    conv = (
        client.table("telegram_conversations").select("*, telegram_business_connections(business_connection_id)")
        .eq("id", conversation_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation = conv[0]
    business_connection_id = conversation["telegram_business_connections"]["business_connection_id"]

    try:
        send_message(business_connection_id, conversation["telegram_chat_id"], body.text)
    except TelegramSendError:
        raise HTTPException(status_code=503, detail="Не удалось отправить сообщение в Telegram — попробуйте ещё раз")
    client.table("telegram_messages").insert({
        "conversation_id": conversation_id, "direction": "outbound",
        "content": body.text, "sent_by": user.email,
    }).execute()
    client.table("telegram_conversations").update({
        "draft_reply": None, "coaching_tip": None, "last_message_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation_id).execute()
    return {"ok": True}
```

Replace with:

```python
@api_router.post("/conversations/{conversation_id}/send")
def send_reply(conversation_id: str, body: SendBody, user=Depends(get_current_user)):
    client = get_service_client()
    conv = (
        client.table("telegram_conversations").select("*, telegram_business_connections(business_connection_id)")
        .eq("id", conversation_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation = conv[0]
    business_connection_id = conversation["telegram_business_connections"]["business_connection_id"]

    try:
        send_message(business_connection_id, conversation["telegram_chat_id"], body.text)
    except TelegramSendError:
        raise HTTPException(status_code=503, detail="Не удалось отправить сообщение в Telegram — попробуйте ещё раз")
    client.table("telegram_messages").insert({
        "conversation_id": conversation_id, "direction": "outbound",
        "content": body.text, "sent_by": user.email,
    }).execute()
    client.table("telegram_conversations").update({
        "draft_reply": None, "coaching_tip": None, "last_message_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation_id).execute()
    try:
        log_ai_event(
            client, user.tenant_id, "draft_sent", "Отправлен черновик ответа клиенту",
            client_id=conversation.get("client_id"), manager_email=user.email,
        )
    except Exception:
        pass  # best-effort -- the message is already sent regardless of whether logging succeeds
    return {"ok": True}
```

(The import from Task 3 already covers `log_ai_event` for this file -- no new import needed here.)

- [ ] **Step 2: Verify the backend imports cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0.

- [ ] **Step 3: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd backend
git add app/routers/telegram_business.py
git commit -m "feat: log draft_sent to the AI journal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Record `event_proposed` outcome on confirm/dismiss

**Files:**
- Modify: `backend/app/routers/calendar.py`

- [ ] **Step 1: Add the import**

Current code near the top of `backend/app/routers/calendar.py`:

```python
from app.db import get_service_client
from app.deps import get_current_user
```

Change to:

```python
from app.db import get_service_client
from app.deps import get_current_user
from app.services.ai_events import mark_event_outcome
```

- [ ] **Step 2: Mark `confirmed` in `confirm_event`**

Current code:

```python
@router.post("/{event_id}/confirm")
def confirm_event(event_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    updated = (
        client.table("calendar_events")
        .update({"status": "confirmed", "created_by": user.email, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", event_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Event not found")
    return updated[0]
```

Replace with:

```python
@router.post("/{event_id}/confirm")
def confirm_event(event_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    updated = (
        client.table("calendar_events")
        .update({"status": "confirmed", "created_by": user.email, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", event_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Event not found")
    try:
        mark_event_outcome(client, user.tenant_id, event_id, "confirmed")
    except Exception:
        pass  # best-effort -- the event is already confirmed regardless of the journal update
    return updated[0]
```

- [ ] **Step 3: Mark `dismissed` in `dismiss_event`**

Current code:

```python
@router.post("/{event_id}/dismiss")
def dismiss_event(event_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    updated = (
        client.table("calendar_events")
        .update({"status": "dismissed", "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", event_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Event not found")
    return updated[0]
```

Replace with:

```python
@router.post("/{event_id}/dismiss")
def dismiss_event(event_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    updated = (
        client.table("calendar_events")
        .update({"status": "dismissed", "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", event_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Event not found")
    try:
        mark_event_outcome(client, user.tenant_id, event_id, "dismissed")
    except Exception:
        pass  # best-effort -- the event is already dismissed regardless of the journal update
    return updated[0]
```

- [ ] **Step 4: Verify the backend imports cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0.

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/routers/calendar.py
git commit -m "feat: record event_proposed outcome on confirm/dismiss

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Log `context_summary` and `client_segments`

**Files:**
- Modify: `backend/app/routers/clients.py`

- [ ] **Step 1: Add the import**

Current code near the top of `backend/app/routers/clients.py`:

```python
from app.ai.brain import gather_client_context
from app.ai.client_context import summarize_client_context
from app.ai.client_segmentation import segment_clients
from app.db import get_service_client
from app.deps import get_current_user
```

Change to:

```python
from app.ai.brain import gather_client_context
from app.ai.client_context import summarize_client_context
from app.ai.client_segmentation import segment_clients
from app.db import get_service_client
from app.deps import get_current_user
from app.services.ai_events import log_ai_event
```

- [ ] **Step 2: Log `context_summary` in `refresh_context_summary`**

Current code:

```python
def refresh_context_summary(client_id: str, user=Depends(get_current_user)):
    """Manager-handover problem: whoever inherits a departed agent's clients
    has no idea what's been discussed. On-demand (not automatic on every
    event, keeps this cheap and simple) -- a manager clicks "Обновить
    сводку" and gets a fresh 2-4 sentence brief synthesized from everything
    known about this client."""
    client = get_service_client()
    context_data = gather_client_context(client, user.tenant_id, client_id)
    if not context_data:
        raise HTTPException(status_code=404, detail="Client not found")
    try:
        summary = summarize_client_context(context_data)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось обновить сводку — попробуйте ещё раз")
    updated = client.table("clients").update({
        "ai_context_summary": summary, "ai_context_generated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", client_id).eq("tenant_id", user.tenant_id).execute().data
    return updated[0]
```

Replace with:

```python
def refresh_context_summary(client_id: str, user=Depends(get_current_user)):
    """Manager-handover problem: whoever inherits a departed agent's clients
    has no idea what's been discussed. On-demand (not automatic on every
    event, keeps this cheap and simple) -- a manager clicks "Обновить
    сводку" and gets a fresh 2-4 sentence brief synthesized from everything
    known about this client."""
    client = get_service_client()
    context_data = gather_client_context(client, user.tenant_id, client_id)
    if not context_data:
        raise HTTPException(status_code=404, detail="Client not found")
    try:
        summary = summarize_client_context(context_data)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось обновить сводку — попробуйте ещё раз")
    updated = client.table("clients").update({
        "ai_context_summary": summary, "ai_context_generated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", client_id).eq("tenant_id", user.tenant_id).execute().data
    try:
        log_ai_event(
            client, user.tenant_id, "context_summary", "Обновлён контекст для передачи",
            client_id=client_id, manager_email=user.email,
        )
    except Exception:
        pass  # best-effort -- the summary is already saved regardless of the journal write
    return updated[0]
```

- [ ] **Step 3: Log `client_segments` in `ai_segment_clients`**

Current code:

```python
    if not summaries:
        return {"segments": []}
    try:
        return segment_clients(summaries)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось получить AI-сегменты — попробуйте ещё раз")
```

Replace with:

```python
    if not summaries:
        return {"segments": []}
    try:
        result = segment_clients(summaries)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось получить AI-сегменты — попробуйте ещё раз")
    try:
        segment_count = len(result.get("segments", []))
        log_ai_event(
            client, user.tenant_id, "client_segments",
            f"AI-сводка клиентов: {segment_count} сегмент(ов) по {len(summaries)} клиентам",
            manager_email=user.email,
        )
    except Exception:
        pass  # best-effort -- the segments are already computed regardless of the journal write
    return result
```

- [ ] **Step 4: Verify the backend imports cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0.

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/routers/clients.py
git commit -m "feat: log context_summary and client_segments to the AI journal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `GET /api/ai-events` — new router

**Files:**
- Create: `backend/app/routers/ai_events.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the router**

```python
"""Журнал AI (ai_events) -- read-side of the transparency log. Tenant-scoped
like everything else in Argus, PLUS role-scoped: a non-boss only ever gets
rows tied to their own manager_email, filtered server-side (never a
client-side filter over the full tenant's data -- a manager's browser
should never even receive another manager's rows). See
docs/superpowers/specs/2026-08-06-ai-events-journal-design.md.
"""
from fastapi import APIRouter, Depends

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/ai-events")


@router.get("")
def list_ai_events(
    kind: str | None = None, client_id: str | None = None,
    user=Depends(get_current_user),
):
    client = get_service_client()
    query = (
        client.table("ai_events").select("*, clients(name, phone)")
        .eq("tenant_id", user.tenant_id)
    )
    if user.role != "boss":
        query = query.eq("manager_email", user.email)
    if kind:
        query = query.eq("kind", kind)
    if client_id:
        query = query.eq("client_id", client_id)
    return query.order("created_at", desc=True).limit(100).execute().data
```

- [ ] **Step 2: Register the router in `main.py`**

Current code:

```python
from app.routers import auth_google, units, leads, spravka, assistant, pricing, analytics, clients, conversations, payments, workspace, telegram_business, calendar, call_logs
```

Change to:

```python
from app.routers import auth_google, units, leads, spravka, assistant, pricing, analytics, clients, conversations, payments, workspace, telegram_business, calendar, call_logs, ai_events
```

Current code:

```python
app.include_router(calendar.router)
app.include_router(call_logs.router)
```

Change to:

```python
app.include_router(calendar.router)
app.include_router(call_logs.router)
app.include_router(ai_events.router)
```

- [ ] **Step 3: Verify the backend imports cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0.

- [ ] **Step 4: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all pass. (No dedicated test file for this router -- consistent with `call_logs.py`/`calendar.py`, verified manually via the dev server in Task 12.)

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/routers/ai_events.py app/main.py
git commit -m "feat: add GET /api/ai-events endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend type — `AiEvent`

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add the type**

Add at the end of `frontend/src/lib/types.ts` (after the existing `TelegramMessage` type):

```typescript

export type AiEvent = {
  id: string;
  tenant_id: string;
  kind: "coaching_tip" | "event_proposed" | "draft_sent" | "context_summary" | "client_segments";
  client_id: string | null;
  manager_email: string | null;
  summary: string;
  outcome: "confirmed" | "dismissed" | null;
  related_id: string | null;
  created_at: string;
  clients?: { name: string | null; phone: string } | null;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/lib/types.ts
git commit -m "feat: add AiEvent type

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `api.ts` — `aiEvents`

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the function**

Current code at the end of the `api` object in `frontend/src/lib/api.ts`:

```typescript
  telegramLinkConversation: (
    conversationId: string,
    body: { client_id?: string; new_client_name?: string; new_client_phone?: string }
  ): Promise<TelegramConversation> =>
    request(`/api/telegram-business/conversations/${conversationId}/link`, { method: "PATCH", body: JSON.stringify(body) }),
};
```

Change to:

```typescript
  telegramLinkConversation: (
    conversationId: string,
    body: { client_id?: string; new_client_name?: string; new_client_phone?: string }
  ): Promise<TelegramConversation> =>
    request(`/api/telegram-business/conversations/${conversationId}/link`, { method: "PATCH", body: JSON.stringify(body) }),

  aiEvents: (params?: { kind?: string; client_id?: string }): Promise<AiEvent[]> => {
    const query = new URLSearchParams();
    if (params?.kind) query.set("kind", params.kind);
    if (params?.client_id) query.set("client_id", params.client_id);
    const qs = query.toString();
    return request(`/api/ai-events${qs ? `?${qs}` : ""}`);
  },
};
```

- [ ] **Step 2: Add the `AiEvent` import**

Current code at the top of `frontend/src/lib/api.ts`:

```typescript
import { CalendarEvent, Client, ClientSegment, TelegramConversation, TelegramMessage } from "./types";
```

Change to:

```typescript
import { AiEvent, CalendarEvent, Client, ClientSegment, TelegramConversation, TelegramMessage } from "./types";
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/lib/api.ts
git commit -m "feat: add api.aiEvents

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `SpaceIndicator.tsx` — new "Журнал AI" section

**Files:**
- Modify: `frontend/src/components/SpaceIndicator.tsx`

- [ ] **Step 1: Extend the `Section` type**

Current code:

```tsx
export type Section = "assistant" | "leads" | "clients" | "units" | "analytics" | "calendar";
```

Replace with:

```tsx
export type Section = "assistant" | "leads" | "clients" | "units" | "analytics" | "calendar" | "ai_journal";
```

- [ ] **Step 2: Add a `SPACES` entry**

Current code (the last entry in the array, `calendar`):

```tsx
  {
    key: "calendar", label: "Календарь", icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="5" width="18" height="16" rx="2.2" /><path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
];
```

Replace with (adds a new entry after `calendar`, NOT `bossOnly` -- every role sees this section, scoped server-side instead):

```tsx
  {
    key: "calendar", label: "Календарь", icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="5" width="18" height="16" rx="2.2" /><path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    key: "ai_journal", label: "Журнал AI", icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M14 3v5h5" /><path d="M8 12h8M8 16h5" />
      </svg>
    ),
  },
];
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: this WILL show errors at this point (`page.tsx`'s `TITLES: Record<Section, string>` is now missing the new key) -- that's expected here, Task 13 fixes it. Confirm the error is specifically about `TITLES` in `page.tsx`, not something else.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/SpaceIndicator.tsx
git commit -m "feat: add ai_journal to the nav Section type

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: `AiJournalPanel.tsx` — new component

**Files:**
- Create: `frontend/src/components/AiJournalPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AiEvent, Client } from "@/lib/types";
import { Dropdown } from "./Dropdown";
import { Skeleton } from "./Skeleton";

const KIND_LABELS: Record<AiEvent["kind"], string> = {
  coaching_tip: "Совет по продаже",
  event_proposed: "Предложено событие",
  draft_sent: "Отправлен черновик",
  context_summary: "Обновлён контекст",
  client_segments: "AI-сводка клиентов",
};

const KIND_COLORS: Record<AiEvent["kind"], string> = {
  coaching_tip: "var(--v-accent)",
  event_proposed: "#7dd3fc",
  draft_sent: "var(--success)",
  context_summary: "var(--v-violet-strong, #7a5cff)",
  client_segments: "var(--warning)",
};

/** "Журнал AI" -- a permanent, role-scoped history of what Argus Brain has
 * actually done (see docs/superpowers/specs/2026-08-06-ai-events-journal-design.md).
 * The backend already scopes rows by role (boss sees the whole tenant, a
 * manager only sees their own manager_email) -- this component just renders
 * whatever it's given, no client-side role filtering needed. */
export function AiJournalPanel({ onOpenClient }: { onOpenClient: (clientId: string) => void }) {
  const [events, setEvents] = useState<AiEvent[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [kindFilter, setKindFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.clients().then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    setEvents(null);
    api.aiEvents({ kind: kindFilter || undefined, client_id: clientFilter || undefined })
      .then(setEvents)
      .catch((e: any) => { setError(`Не удалось загрузить журнал: ${e.message}`); setEvents([]); });
  }, [kindFilter, clientFilter]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Журнал AI</h1>
      <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 18px" }}>Что Argus Brain сделал и что с этим решили</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <Dropdown
          value={kindFilter} onChange={setKindFilter} placeholder="Все типы"
          options={[
            { value: "", label: "Все типы" },
            ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
          ]}
          style={{ width: 220 }}
        />
        <Dropdown
          value={clientFilter} onChange={setClientFilter} placeholder="Все клиенты"
          options={[
            { value: "", label: "Все клиенты" },
            ...clients.map((c) => ({ value: c.id, label: c.name || c.phone })),
          ]}
          style={{ width: 220 }}
        />
      </div>

      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {events === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map((i) => <Skeleton key={i} height={52} />)}
        </div>
      ) : events.length === 0 ? (
        <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Пока нет записей — журнал наполняется по мере работы AI.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {events.map((e) => (
            <div key={e.id} className="glass-panel" style={{ padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: KIND_COLORS[e.kind], flexShrink: 0, marginTop: 5 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: KIND_COLORS[e.kind], textTransform: "uppercase", letterSpacing: ".03em" }}>
                    {KIND_LABELS[e.kind]}
                  </span>
                  {e.outcome && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, borderRadius: 99, padding: "2px 8px",
                      background: e.outcome === "confirmed" ? "var(--success-tint)" : "var(--surface-05)",
                      color: e.outcome === "confirmed" ? "var(--success)" : "var(--color-text-faint)",
                    }}>
                      {e.outcome === "confirmed" ? "Подтверждено" : "Отклонено"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "var(--color-text)", marginTop: 4 }}>{e.summary}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 4, display: "flex", gap: 10 }}>
                  <span>{new Date(e.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  {e.clients && (
                    <span onClick={() => onOpenClient(e.client_id!)} style={{ color: "var(--v-accent)", cursor: "pointer", fontWeight: 600 }}>
                      {e.clients.name || e.clients.phone} →
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: still shows the same `TITLES` error from Task 10 (expected, unfixed until Task 13) -- confirm no NEW errors were introduced by this file itself (read the error output carefully; it should only mention `page.tsx`'s `TITLES`, nothing about `AiJournalPanel.tsx`).

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/components/AiJournalPanel.tsx
git commit -m "feat: add AiJournalPanel component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Wire `AiJournalPanel` into `page.tsx`

**Files:**
- Modify: `frontend/src/app/app/page.tsx`

- [ ] **Step 1: Add the import**

Current code:

```tsx
import { CalendarPanel } from "@/components/CalendarPanel";
import { AssistantWidget } from "@/components/AssistantWidget";
```

Change to:

```tsx
import { CalendarPanel } from "@/components/CalendarPanel";
import { AiJournalPanel } from "@/components/AiJournalPanel";
import { AssistantWidget } from "@/components/AssistantWidget";
```

- [ ] **Step 2: Add the `TITLES` entry**

Current code:

```tsx
const TITLES: Record<Section, string> = {
  assistant: "Ассистент",
  units: "Юниты",
  leads: "Лиды",
  clients: "Клиенты",
  analytics: "Аналитика",
  calendar: "Календарь",
};
```

Replace with:

```tsx
const TITLES: Record<Section, string> = {
  assistant: "Ассистент",
  units: "Юниты",
  leads: "Лиды",
  clients: "Клиенты",
  analytics: "Аналитика",
  calendar: "Календарь",
  ai_journal: "Журнал AI",
};
```

- [ ] **Step 3: Add the render branch**

Current code:

```tsx
              {s.key === "calendar" && <CalendarPanel onOpenClient={openClientFromLead} />}
```

Change to:

```tsx
              {s.key === "calendar" && <CalendarPanel onOpenClient={openClientFromLead} />}
              {s.key === "ai_journal" && <AiJournalPanel onOpenClient={openClientFromLead} />}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output -- this resolves the `TITLES` error flagged in Tasks 10/11.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/app/app/page.tsx
git commit -m "feat: wire AiJournalPanel into the app shell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Manual verification pass + deploy

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all tests pass (existing suite + the new `test_ai_events.py`).

- [ ] **Step 2: Run the frontend typecheck on the whole tree**

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

- [ ] **Step 4: Trigger at least one of each loggable event and confirm it lands in `ai_events`**

- Open a client's "Контекст для передачи" and click "Обновить" -- then check:
```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/ai_events?select=*&kind=eq.context_summary&order=created_at.desc&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: one row with `kind: "context_summary"`, the right `client_id`, and your login email as `manager_email`.

- On Клиенты, select a few clients and run "✨ AI-сводка" -- check:
```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/ai_events?select=*&kind=eq.client_segments&order=created_at.desc&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: one row, `summary` mentioning a segment count.

- If a Telegram conversation with a pending calendar proposal exists, confirm or dismiss it from the Календарь tab -- check:
```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/ai_events?select=*&kind=eq.event_proposed&order=created_at.desc&limit=3" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: the row's `outcome` reflects whichever action you took (`confirmed` or `dismissed`). If no pending proposal exists to test with, note this as a gap in your verification report rather than skipping the check silently.

- [ ] **Step 5: Visually confirm the new nav section**

Open the app, confirm a new "Журнал AI" icon/dot appears in the bottom nav (not boss-only -- visible for both roles if you can preview-toggle role as boss). Click it, confirm the panel loads, shows the events logged in Step 4, and the kind/client dropdown filters actually narrow the list.

- [ ] **Step 6: Confirm role-scoping works**

As a non-boss manager (or using the boss's "Предпросмотр" role-preview toggle already in `HudToolbar`), confirm the journal only shows events where `manager_email` matches that manager -- not events belonging to a different manager. Cross-check against the raw `ai_events` table (via the curl commands above) to confirm the filtering is real, not just visually plausible.

- [ ] **Step 7: Push to trigger the Railway deploy**

```bash
git push origin main
```

Then poll `railway status` until both services show `● Online`, and check `railway logs` for any startup errors (particularly import errors from the new `ai_events` router registration).
