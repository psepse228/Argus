# Argus Brain — Phase 2a: stage pipeline + call-outcome logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the client pipeline (`leads.stage`) all the way to `contract_signed` (it currently stops at `paid_reservation`), and add manual call-outcome logging (взял/не взял/отложил) at every existing click-to-call button — the two foundational data-capture pieces the Phase 2b daily-briefing reminder engine will reason over.

**Architecture:** Two independent, additive schema changes (stage enum extension + a new `call_logs` table), a small new backend router for logging calls, and one new shared frontend component (`CallButton`) replacing four near-duplicate `<a href="tel:">` anchors so the popover logic exists in exactly one place.

**Tech Stack:** FastAPI + Supabase (plain `def`, explicit `tenant_id` filtering), pytest with hand-rolled fake Supabase clients where the codebase already tests pure logic (this plan follows the established convention of NOT writing router-level tests — `leads.py`/`call_logs.py` endpoints are verified manually via the dev server, matching how `clients.py`/`assistant.py`/`calendar.py` are already verified in this codebase), Next.js/React (no test runner configured).

**Scope note:** This is Phase 2a of `docs/superpowers/specs/2026-08-05-argus-brain-design.md`. Phase 2b (meeting notes, the AI-generated daily briefing replacing `TodayQueue.tsx`'s rules, `daily_briefings` caching) depends on the data this phase captures and gets its own follow-up plan. One deliberate deviation from the original spec text: the spec sketched `POST /api/leads/{id}/call-outcome`, but a call can be logged from Клиенты/Юниты too, where there's a `client_id` in scope but no `lead_id` — so this plan uses a flat `POST /api/call-logs` accepting either id, not a leads-nested path.

---

### Task 1: Migration — extend `leads.stage` + add `reserved_at`

**Files:**
- Create: `backend/supabase/migrations/0026_leads_stage_pipeline.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Argus Brain Phase 2a: the client pipeline (leads.stage) stopped at
-- paid_reservation -- there was no way to represent "deal in progress" or
-- "contract signed" at all, even though units.status has had parallel
-- values (deal_in_progress/deal_completed) since day one. Confirmed against
-- the real Ulkan process during the 2026-08-05 brainstorm: холодный ->
-- подбор -> встреча назначена -> встреча прошла -> резерв -> оплаченный
-- резерв -> сделка в процессе -> договор подписан.
--
-- The original check constraint's name wasn't set explicitly in
-- 0001_init_schema.sql (same situation as units.status, fixed in migration
-- 0024) -- find and drop it dynamically rather than guess.
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.leads'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%unsorted%';
  if con_name is not null then
    execute format('alter table public.leads drop constraint %I', con_name);
  end if;
end $$;

alter table public.leads add constraint leads_stage_check check (
  stage in (
    'unsorted', 'matching', 'meeting_scheduled', 'meeting_held',
    'reserved', 'paid_reservation', 'deal_in_progress', 'contract_signed'
  )
);

-- Anchor for the 3-day reservation-expiry reminder (Phase 2b) -- set once,
-- the first time a lead's stage transitions to 'reserved' (see
-- backend/app/routers/leads.py::update_lead_stage). Not the same as the
-- generic `updated_at`, which changes on any edit to the lead, not just
-- this specific transition.
alter table public.leads add column reserved_at timestamptz;
```

- [ ] **Step 2: Push the migration**

Run: `cd backend && npx.cmd supabase db push --linked`
Expected: `Applying migration 0026_leads_stage_pipeline.sql...` then `"message": "Finished supabase db push."`

- [ ] **Step 3: Verify live**

```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/leads?select=id,stage,reserved_at&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: valid JSON (not a `42703` column-not-found error), and confirm `reserved_at` appears in the row (as `null` for existing rows).

Also run `cd backend && npx.cmd supabase migration list` and confirm `0026` shows a non-empty `remote` value (fully applied, not just locally tracked — this is the exact failure mode that caused a production 500 earlier this week).

- [ ] **Step 4: Commit**

```bash
cd backend
git add supabase/migrations/0026_leads_stage_pipeline.sql
git commit -m "feat: extend leads.stage to contract_signed, add reserved_at

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — `call_logs` table

**Files:**
- Create: `backend/supabase/migrations/0027_call_logs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Argus Brain Phase 2a: manual call-outcome logging. Argus has no telephony
-- integration (click-to-call stays a `tel:` link, per the Day 5 decision --
-- see the week plan) and can't detect whether a call was answered, so a
-- manager logs it themselves via a small popover next to the call button.
-- This is the raw signal the Phase 2b daily briefing reasons over -- e.g.
-- "last call logged no_answer -> remind to retry in a few hours."
create table public.call_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  outcome text not null check (outcome in ('answered', 'no_answer', 'postponed')),
  logged_by text not null,
  created_at timestamptz not null default now()
);

create index on public.call_logs (tenant_id, lead_id);
create index on public.call_logs (tenant_id, client_id);
```

- [ ] **Step 2: Push the migration**

Run: `cd backend && npx.cmd supabase db push --linked`
Expected: `Applying migration 0027_call_logs.sql...` then `"message": "Finished supabase db push."`

- [ ] **Step 3: Verify live**

```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/call_logs?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: `[]` (empty array, table exists and is queryable — not a `42P01` relation-does-not-exist error).

Also run `cd backend && npx.cmd supabase migration list` and confirm `0027` shows a non-empty `remote` value.

- [ ] **Step 4: Commit**

```bash
cd backend
git add supabase/migrations/0027_call_logs.sql
git commit -m "feat: add call_logs table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `leads.py` — extend `STAGES`, set `reserved_at` on transition into `reserved`

**Files:**
- Modify: `backend/app/routers/leads.py`

- [ ] **Step 1: Update the `STAGES` constant**

Current code in `backend/app/routers/leads.py`:

```python
STAGES = ["unsorted", "matching", "meeting_scheduled", "meeting_held", "reserved", "paid_reservation"]
```

Replace with:

```python
STAGES = [
    "unsorted", "matching", "meeting_scheduled", "meeting_held",
    "reserved", "paid_reservation", "deal_in_progress", "contract_signed",
]
```

- [ ] **Step 2: Set `reserved_at` the first time a lead transitions into `reserved`**

Current code:

```python
@router.patch("/{lead_id}/stage")
def update_lead_stage(lead_id: str, body: LeadStageUpdate, user=Depends(get_current_user)):
    if body.stage not in STAGES:
        raise HTTPException(status_code=400, detail=f"stage must be one of {STAGES}")
    client = get_service_client()
    res = (
        client.table("leads")
        .update({"stage": body.stage, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", lead_id)
        .eq("tenant_id", user.tenant_id)  # tenant-scoped even though single-tenant today
        .execute()
    )
    # Supabase's .update() returns 200 with an empty list when the filter
    # matches nothing (bad id, or a real id from a different tenant) — that
    # is not the same as success and must not be reported as one.
    if not res.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    return res.data
```

Replace with:

```python
@router.patch("/{lead_id}/stage")
def update_lead_stage(lead_id: str, body: LeadStageUpdate, user=Depends(get_current_user)):
    if body.stage not in STAGES:
        raise HTTPException(status_code=400, detail=f"stage must be one of {STAGES}")
    client = get_service_client()
    updates = {"stage": body.stage, "updated_at": datetime.now(timezone.utc).isoformat()}
    if body.stage == "reserved":
        # Anchor for the 3-day reservation-expiry reminder (Phase 2b) --
        # only set the first time a lead enters this stage, not every time
        # (a lead bouncing in and out of 'reserved' shouldn't keep pushing
        # its deadline back).
        current = (
            client.table("leads").select("stage")
            .eq("id", lead_id).eq("tenant_id", user.tenant_id).execute().data
        )
        if current and current[0]["stage"] != "reserved":
            updates["reserved_at"] = datetime.now(timezone.utc).isoformat()
    res = (
        client.table("leads")
        .update(updates)
        .eq("id", lead_id)
        .eq("tenant_id", user.tenant_id)  # tenant-scoped even though single-tenant today
        .execute()
    )
    # Supabase's .update() returns 200 with an empty list when the filter
    # matches nothing (bad id, or a real id from a different tenant) — that
    # is not the same as success and must not be reported as one.
    if not res.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    return res.data
```

- [ ] **Step 3: Verify the backend still imports cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0.

- [ ] **Step 4: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all tests pass (this codebase has no dedicated test file for `leads.py`'s router endpoints — consistent with `clients.py`/`assistant.py`/`calendar.py`, which are also verified manually via the dev server, not pytest. Don't add one here either.)

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/routers/leads.py
git commit -m "feat: extend lead pipeline to contract_signed, track reserved_at

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `call_logs.py` — new router

**Files:**
- Create: `backend/app/routers/call_logs.py`

- [ ] **Step 1: Write the router**

```python
"""Call-outcome logging (Argus Brain Phase 2a): a manager clicks a click-to-
call button, then logs what happened -- взял/не взял/отложил -- since Argus
has no telephony integration and can't detect this automatically (see the
Day 5 telephony decision: click-to-call stays a `tel:` link, not a PBX/AMI
integration). This is the raw signal Phase 2b's daily briefing reasons over
-- "call didn't get picked up -> remind to retry" needs to know a call was
even attempted.

Not nested under /api/leads/{id}/ like the original spec draft assumed -- a
call can be logged from Клиенты/Юниты too, where there's a client_id in
scope but no lead_id, so a flat endpoint that accepts either is the honest
shape for how this is actually used.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/call-logs")

OUTCOMES = ["answered", "no_answer", "postponed"]


class CallLogCreate(BaseModel):
    outcome: str
    lead_id: str | None = None
    client_id: str | None = None


@router.post("")
def log_call(body: CallLogCreate, user=Depends(get_current_user)):
    if body.outcome not in OUTCOMES:
        raise HTTPException(status_code=400, detail=f"outcome must be one of {OUTCOMES}")
    if not body.lead_id and not body.client_id:
        raise HTTPException(status_code=400, detail="lead_id or client_id is required")
    client = get_service_client()
    if body.lead_id:
        owned = (
            client.table("leads").select("id")
            .eq("id", body.lead_id).eq("tenant_id", user.tenant_id).execute().data
        )
        if not owned:
            raise HTTPException(status_code=404, detail="Lead not found")
    if body.client_id:
        owned = (
            client.table("clients").select("id")
            .eq("id", body.client_id).eq("tenant_id", user.tenant_id).execute().data
        )
        if not owned:
            raise HTTPException(status_code=404, detail="Client not found")
    inserted = client.table("call_logs").insert({
        "tenant_id": user.tenant_id, "lead_id": body.lead_id, "client_id": body.client_id,
        "outcome": body.outcome, "logged_by": user.email,
    }).execute().data
    return inserted[0]
```

- [ ] **Step 2: Register the router in `main.py`**

Current code in `backend/app/main.py`:

```python
from app.routers import auth_google, units, leads, spravka, assistant, pricing, analytics, clients, conversations, payments, workspace, telegram_business, calendar
```

Change to:

```python
from app.routers import auth_google, units, leads, spravka, assistant, pricing, analytics, clients, conversations, payments, workspace, telegram_business, calendar, call_logs
```

And current code:

```python
app.include_router(calendar.router)
```

Change to:

```python
app.include_router(calendar.router)
app.include_router(call_logs.router)
```

- [ ] **Step 3: Verify the backend imports cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0.

- [ ] **Step 4: Run the full test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all tests pass. (No dedicated test file for this router either, per Task 3's note — validation logic here is simple enough that manual verification in Task 14 covers it.)

- [ ] **Step 5: Manually smoke-test the endpoint against the live dev server**

(This step needs a running backend — if one isn't already up, start it: `cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8010` in a separate terminal, then come back here.)

Get a real lead id and tenant first:
```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/leads?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

This confirms a real lead id exists to reference; full end-to-end request testing (with real auth cookies) happens in Task 14's Playwright pass, not here — this step is just confirming the table/router wiring by inspecting data, not calling the authenticated endpoint directly.

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/routers/call_logs.py app/main.py
git commit -m "feat: add POST /api/call-logs endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend types — `Lead.reserved_at`

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add the field**

Current code:

```typescript
export type Lead = {
  id: string;
  phone: string;
  source: string | null;
  buy_intent: string | null;
  stage: string;
  assigned_manager: string | null;
  priority?: Priority | null;
  is_stale?: boolean;
  created_at: string;
};
```

Replace with:

```typescript
export type Lead = {
  id: string;
  phone: string;
  source: string | null;
  buy_intent: string | null;
  stage: string;
  assigned_manager: string | null;
  priority?: Priority | null;
  is_stale?: boolean;
  reserved_at?: string | null;
  created_at: string;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/lib/types.ts
git commit -m "feat: add reserved_at to Lead type

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `api.ts` — `logCallOutcome`

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the function**

Current code in `frontend/src/lib/api.ts`:

```typescript
  updateLeadPriority: (id: string, priority: string | null) =>
    request(`/api/leads/${id}/priority`, { method: "PATCH", body: JSON.stringify({ priority }) }),
```

Change to (adds a new function right after it):

```typescript
  updateLeadPriority: (id: string, priority: string | null) =>
    request(`/api/leads/${id}/priority`, { method: "PATCH", body: JSON.stringify({ priority }) }),
  logCallOutcome: (body: { outcome: "answered" | "no_answer" | "postponed"; lead_id?: string; client_id?: string }) =>
    request("/api/call-logs", { method: "POST", body: JSON.stringify(body) }),
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/lib/api.ts
git commit -m "feat: add api.logCallOutcome

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `CallButton.tsx` — new shared component

**Files:**
- Create: `frontend/src/components/CallButton.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";
import { useState } from "react";
import { api } from "@/lib/api";

/** Replaces four near-identical `<a href="tel:...">` anchors (Лиды,
 * Клиенты card, Клиенты detail, Юниты detail) with one shared component --
 * same tel: link behavior, plus a small popover to log what happened
 * (взял/не взял/отложил), since Argus has no telephony integration and
 * can't detect this automatically (Day 5 decision: click-to-call stays a
 * plain link). Pass whichever id is in scope -- lead_id, client_id, or
 * both; at least one should be set for the log to be useful, but this
 * component doesn't enforce that, the backend does. */
export function CallButton({
  phone, size = 20, leadId, clientId,
}: {
  phone: string; size?: number; leadId?: string; clientId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);

  async function logOutcome(outcome: "answered" | "no_answer" | "postponed") {
    setLogging(true);
    try {
      await api.logCallOutcome({ outcome, lead_id: leadId, client_id: clientId });
      setLogged(true);
      setTimeout(() => { setOpen(false); setLogged(false); }, 1200);
    } catch {
      /* best-effort -- the call itself already happened regardless of whether logging succeeds */
    } finally {
      setLogging(false);
    }
  }

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <a
        href={`tel:${phone}`}
        title="Позвонить"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="press"
        style={{
          width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--success-tint)", color: "var(--success)", flexShrink: 0,
        }}
      >
        <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="none" stroke="currentColor" strokeWidth={2.3}>
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
        </svg>
      </a>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="glass-panel"
          style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 50, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}
        >
          {logged ? (
            <div style={{ fontSize: 11.5, color: "var(--success)", fontWeight: 700 }}>Записано ✓</div>
          ) : (
            <>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--color-text-faint)" }}>
                Как прошёл звонок?
              </div>
              <button
                disabled={logging} onClick={() => logOutcome("answered")} className="press"
                style={{ fontSize: 12, fontWeight: 600, color: "var(--success)", background: "var(--success-tint)", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", textAlign: "left" }}
              >
                Взял трубку
              </button>
              <button
                disabled={logging} onClick={() => logOutcome("no_answer")} className="press"
                style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", background: "var(--danger-tint)", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", textAlign: "left" }}
              >
                Не взял
              </button>
              <button
                disabled={logging} onClick={() => logOutcome("postponed")} className="press"
                style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-soft)", background: "var(--surface-05)", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", textAlign: "left" }}
              >
                Отложил
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{ fontSize: 10.5, color: "var(--color-text-faint)", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, marginTop: 2 }}
              >
                Закрыть
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (this file isn't imported anywhere yet, so this just confirms the file itself compiles).

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/components/CallButton.tsx
git commit -m "feat: add shared CallButton component with outcome logging

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire `CallButton` into `LeadsPanel.tsx`

**Files:**
- Modify: `frontend/src/components/LeadsPanel.tsx`

- [ ] **Step 1: Add the import**

Find the existing imports near the top of `frontend/src/components/LeadsPanel.tsx`:

```tsx
import { Dropdown } from "./Dropdown";
import { Skeleton } from "./Skeleton";
```

Change to:

```tsx
import { CallButton } from "./CallButton";
import { Dropdown } from "./Dropdown";
import { Skeleton } from "./Skeleton";
```

- [ ] **Step 2: Replace the raw anchor**

Current code (inside the lead card, around where `l.phone` is shown):

```tsx
                      <a
                        href={`tel:${l.phone}`}
                        title="Позвонить"
                        className="press"
                        style={{
                          width: 20, height: 20, flexShrink: 0, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                          background: "var(--success-tint)", color: "var(--success)",
                        }}
                      >
                        <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.3}>
                          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
                        </svg>
                      </a>
```

Replace with:

```tsx
                      <CallButton phone={l.phone} size={20} leadId={l.id} />
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/LeadsPanel.tsx
git commit -m "feat: log call outcomes from Лиды

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Wire `CallButton` into `ClientsPanel.tsx`

**Files:**
- Modify: `frontend/src/components/ClientsPanel.tsx`

- [ ] **Step 1: Add the import**

Find the imports near the top of `frontend/src/components/ClientsPanel.tsx` and add:

```tsx
import { CallButton } from "./CallButton";
```

(Add it alongside whatever other component imports already exist there, in the same alphabetical-ish grouping the file already uses.)

- [ ] **Step 2: Replace the raw anchor**

Current code:

```tsx
            <a
              href={`tel:${c.phone}`}
              title="Позвонить"
              onClick={(e) => e.stopPropagation()}
              className="press"
              style={{
                width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--success-tint)", color: "var(--success)", flexShrink: 0,
              }}
            >
              <svg viewBox="0 0 24 24" width={9} height={9} fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
              </svg>
            </a>
```

Replace with:

```tsx
            <CallButton phone={c.phone} size={16} clientId={c.id} />
```

(`CallButton` already calls `e.stopPropagation()` internally on the anchor's own click, matching what the old inline `onClick` did -- no separate stopPropagation wrapper needed here.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/ClientsPanel.tsx
git commit -m "feat: log call outcomes from Клиенты list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Wire `CallButton` into `ClientInfoCard.tsx`

**Files:**
- Modify: `frontend/src/components/ClientInfoCard.tsx`

- [ ] **Step 1: Add the import** (alongside the file's existing component imports)

```tsx
import { CallButton } from "./CallButton";
```

- [ ] **Step 2: Replace the raw anchor**

Current code:

```tsx
                  <a
                    href={`tel:${selected.phone}`}
                    title="Позвонить"
                    className="press"
                    style={{
                      width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                      background: "var(--success-tint)", color: "var(--success)", flexShrink: 0,
                    }}
                  >
                    <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.3}>
                      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
                    </svg>
                  </a>
```

Replace with:

```tsx
                  <CallButton phone={selected.phone} size={22} clientId={selected.id} />
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/ClientInfoCard.tsx
git commit -m "feat: log call outcomes from client detail card

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Wire `CallButton` into `UnitsPanel.tsx`

**Files:**
- Modify: `frontend/src/components/UnitsPanel.tsx`

- [ ] **Step 1: Add the import** (alongside the file's existing component imports)

```tsx
import { CallButton } from "./CallButton";
```

- [ ] **Step 2: Replace the raw anchor**

Current code:

```tsx
                      <a
                        href={`tel:${selected.client_phone}`}
                        title="Позвонить"
                        className="press"
                        style={{
                          width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                          background: "var(--success-tint)", color: "var(--success)", flexShrink: 0,
                        }}
                      >
                        <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={2.5}>
                          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
                        </svg>
                      </a>
```

Replace with:

```tsx
                      <CallButton phone={selected.client_phone} size={18} />
```

(No `clientId`/`leadId` prop here — `UnitsPanel`'s `selected` unit only has `client_name`/`client_phone` strings, not a client id, so this call gets logged with neither id set. That's an accepted gap for this task, not a bug: the backend requires at least one id and will 400 if neither is passed, so if this specific call site needs logging to actually work, `selected` would need a `client_id` field added to the `Unit` type and to `units.py`'s select query first -- that's out of scope here since it touches the units data model, not the call-logging feature itself. Confirm this gap explicitly during Task 14's manual verification rather than silently shipping a button that 400s.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/UnitsPanel.tsx
git commit -m "feat: wire CallButton into Юниты client-phone display

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: `LeadsPanel.tsx` — surface the two new stages on the Kanban board

**Files:**
- Modify: `frontend/src/components/LeadsPanel.tsx`

- [ ] **Step 1: Extend the local `STAGES` array**

Current code:

```tsx
const STAGES = [
  { key: "unsorted", label: "Неразобранное", color: "var(--color-text-faint)" },
  { key: "matching", label: "Подбор", color: "var(--v-violet-strong, #7a5cff)" },
  { key: "meeting_scheduled", label: "Встреча назначена", color: "#7dd3fc" },
  { key: "meeting_held", label: "Встреча проведена", color: "var(--warning)" },
  { key: "reserved", label: "Бронь", color: "var(--v-accent)" },
  { key: "paid_reservation", label: "Платная бронь", color: "var(--success)" },
];
```

Replace with:

```tsx
const STAGES = [
  { key: "unsorted", label: "Неразобранное", color: "var(--color-text-faint)" },
  { key: "matching", label: "Подбор", color: "var(--v-violet-strong, #7a5cff)" },
  { key: "meeting_scheduled", label: "Встреча назначена", color: "#7dd3fc" },
  { key: "meeting_held", label: "Встреча проведена", color: "var(--warning)" },
  { key: "reserved", label: "Бронь", color: "var(--v-accent)" },
  { key: "paid_reservation", label: "Платная бронь", color: "var(--success)" },
  { key: "deal_in_progress", label: "Сделка в процессе", color: "#f59e0b" },
  { key: "contract_signed", label: "Договор подписан", color: "#22c55e" },
];
```

(This array already drives both the Kanban column layout and the per-lead stage-move dropdown via `STAGES.map(...)` elsewhere in the same file — no other code in this file needs to change for the two new columns/dropdown options to appear.)

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/components/LeadsPanel.tsx
git commit -m "feat: surface deal_in_progress/contract_signed on the Лиды board

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Manual verification pass + deploy

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all existing tests pass (no new tests were added this phase, per Tasks 3/4's notes on this codebase's router-testing convention).

- [ ] **Step 2: Run the frontend typecheck one more time on the whole tree**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Start both dev servers** (kill and restart fresh if already running, so they pick up every change from this phase — absolute `.venv` python path for the backend, per this week's established lesson about stale-Python-process bugs)

```bash
# backend, from backend/
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8010
```
```bash
# frontend, from frontend/
npm run dev
```

- [ ] **Step 4: Visually confirm the Лиды board**

Open Лиды (dev-bypass login). Confirm:
- Two new columns appear: "Сделка в процессе" and "Договор подписан", at the end of the existing 6.
- The stage-move dropdown on any lead card now offers all 8 stages.
- Click the call icon on a lead card — confirm the outcome popover appears (взял трубку / не взял / отложил / закрыть), and clicking an outcome shows "Записано ✓" then auto-closes.

- [ ] **Step 5: Visually confirm Клиенты and the client detail card**

Open Клиенты, confirm the call icon on a client card still triggers the same popover. Open a client's detail view (via "Открыть в Мастерской" or however the detail card is reached) and confirm the same there.

- [ ] **Step 6: Confirm `reserved_at` actually gets set**

Move a lead that isn't currently `reserved` into the `reserved` stage via the UI dropdown, then check it directly:

```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/leads?select=id,stage,reserved_at&stage=eq.reserved&limit=5" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: the lead you just moved shows a non-null `reserved_at` close to the current time.

- [ ] **Step 7: Confirm a logged call actually lands in `call_logs`**

After logging an outcome via the UI in Step 4 or 5:

```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/call_logs?select=*&order=created_at.desc&limit=3" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: your just-logged outcome appears, with either `lead_id` or `client_id` set matching where you clicked from.

- [ ] **Step 8: Push to trigger the Railway deploy**

```bash
git push origin main
```

Then poll `railway status` until both services show `● Online`, and check `railway logs` for any startup errors (particularly import errors from the new `call_logs` router registration).
