# Журнал AI (ai_events) — design

## Problem

Argus Brain (`docs/superpowers/specs/2026-08-05-argus-brain-design.md`) was deliberately built as invisible plumbing — a shared context layer surfaced only through existing screens (Мастерская's advisor panel, "На сегодня", the owner's "Сводка" tab). That was the right call architecturally (avoids a confusing "5th AI voice"), but it left a real gap the user raised directly on 2026-08-06: there's no way to see what the AI has actually done over time. Everything is either ephemeral (`coaching_tip`/`summary` on `telegram_conversations` get overwritten on every new message, `draft_reply` gets cleared on send) or scattered across screens with no unified history.

The user's framing: Argus Brain is meant to work like a "papa AI" that directs managers, not just a passive assistant — and a manager being directed by something they can't see a track record of doesn't build trust. This is a transparency/audit feature, not a new AI capability.

## Scope

- A new, append-only `ai_events` table that existing (and future) AI call-sites write to *after* they've already produced their result — no new OpenAI calls, this is pure logging.
- A new nav section, "Журнал AI" (`Section` key `ai_journal`), visible to every role (not boss-only, unlike "Аналитика") — a manager sees only events tied to their own clients/leads, the boss sees everything across the tenant.
- Retrofitting the 5 existing AI call-sites that produce something worth logging: `coaching_tip` generation, calendar event proposals, sent Telegram drafts, client context-summary refreshes, and client AI-segmentation runs.

**Explicitly not in scope**: logging every single Telegram message evaluation (the user chose "only significant" over "log everything" — logging `summary`/`next_step` on every inbound message would make the journal a firehose, and those two fields are already visible live in the Мастерская advisor panel, so logging them again here adds noise without adding information). Phase 2b's daily briefing and Phase 3's owner summary aren't built yet — this spec defines the `ai_events` shape so they can write to it when they ship, but doesn't build them now.

## Product decisions (from brainstorm)

1. **Real history, not a live snapshot.** Every event is a permanent row, not a mutable "current state" that later actions overwrite — the user chose this explicitly over a cheaper live-aggregation-only approach, specifically because the underlying data (`coaching_tip` etc.) already gets overwritten and that's the transparency gap being fixed.
2. **Only significant events get logged**, not every AI invocation:
   - `coaching_tip` — only when `telegram_evaluator.py` actually returns a non-null tip (per Phase 1's design, most trivial messages return `null` here on purpose)
   - `event_proposed` — when the Telegram webhook inserts a `calendar_events` proposal row (already happens; this just also logs it)
   - `draft_sent` — when a manager actually sends a Telegram draft reply (not when a draft is merely generated — generation already shows live in the advisor panel, sending is the meaningful, permanent action)
   - `context_summary` — every "Контекст для передачи" refresh (on-demand, low volume by construction)
   - `client_segments` — every "AI-сводка" run on Клиенты (on-demand, low volume by construction)
3. **Visibility is role-scoped, not boss-only.** Directly contradicts what would otherwise be the default pattern (like "Аналитика", boss-only) — the user was explicit that a "papa AI directing managers" only works if managers can see what it's telling them and why. A manager's view is filtered to events where `manager_email` matches their own login; the boss sees the whole tenant, unfiltered.
4. **Outcome tracking is best-effort, not universal.** Only `event_proposed` has a real accept/reject action today (`calendar.py`'s confirm/dismiss) — its `outcome` column gets updated when that happens. `coaching_tip`/`context_summary`/`client_segments` have no corresponding human decision in the app today (they're informational, not proposals), so their `outcome` stays `null` forever — that's correct, not a gap to fill artificially.

## Architecture

### Data model

```sql
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

- `summary`: a pre-rendered, human-readable one-liner (e.g. `"Совет: клиент упомянул бюджет — предложи рассрочку"`, `"Предложено событие: Встреча с клиентом, 12 авг 15:00"`, `"Сводка обновлена для Сардор Тошев"`) — computed once at write time by the Python caller, not re-derived in the frontend, so the journal never needs to join back into `telegram_conversations`/`clients` just to render a sentence.
- `related_id`: points at the row this event is *about* (a `calendar_events.id` for `event_proposed`, so its `outcome` can be looked up/updated later) — nullable, only meaningful for `event_proposed` in this phase.
- `manager_email`: for Telegram-sourced events (`coaching_tip`, `event_proposed`, `draft_sent`), pulled from `telegram_business_connections.manager_email` (the connection already carries this). For Клиенты-tab events (`context_summary`, `client_segments`), it's simply `user.email` from the request that triggered them.
- No `updated_at` — `outcome` is the only field that ever changes post-insert, and its own presence/absence is enough signal without needing a second timestamp.

### Write points (existing files, each gets one new insert call)

- `backend/app/routers/telegram_business.py`'s webhook: after persisting `coaching_tip` (Phase 1), if it's non-null, insert a `coaching_tip` event. After inserting a `calendar_events` proposal row, insert an `event_proposed` event with `related_id` = the new proposal's id.
- `backend/app/routers/telegram_business.py`'s `send_reply`: after a successful send, insert a `draft_sent` event.
- `backend/app/routers/calendar.py`'s `confirm_event`/`dismiss_event`: update the matching `ai_events` row's `outcome` (found via `related_id` = the confirmed/dismissed event's id) to `'confirmed'`/`'dismissed'`, best-effort (a missing journal row — e.g. a manually-created event that was never an AI proposal — is not an error).
- `backend/app/routers/clients.py`'s `refresh_context_summary`: after a successful summary, insert a `context_summary` event.
- `backend/app/routers/clients.py`'s `ai-segments` endpoint: after a successful run, insert one `client_segments` event (not one per client/segment — one event for the whole run, `summary` mentions the segment count).

All of these are additive, best-effort inserts (wrapped so a journal-write failure never breaks the underlying feature) — matching this codebase's existing "best-effort, never break the real feature" convention already used for the auto-greeting and event-proposal code in `telegram_business.py`.

### Read API

`GET /api/ai-events` — tenant-scoped, plus role-scoped: if `user.role != "boss"`, filter to `manager_email = user.email` server-side (not a client-side filter — a manager's browser should never receive another manager's rows at all). Supports optional query params `kind` and `client_id` for the two frontend filters. Ordered by `created_at desc`, capped (e.g. 100 most recent) rather than fully paginated — matches the "keep UI simple" instruction and this app's real data volume (2 managers, not thousands of events/day).

### Frontend

- `Section` type gains `"ai_journal"`; `SPACES` gains an entry (NOT `bossOnly`), label "Журнал AI".
- New `AiJournalPanel.tsx`: a simple list, one row per event — timestamp, a small kind-specific icon/label, the pre-rendered `summary` text, a link to the client (if `client_id` set) reusing the existing "open client" navigation callback already threaded through other panels, and an outcome badge (green "Подтверждено" / grey "Отклонено") when `outcome` is set. Two dropdowns above the list (kind, client) reusing the existing `Dropdown` component.
