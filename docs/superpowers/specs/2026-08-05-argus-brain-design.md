# Argus Brain — shared AI context layer, stage reminders, help chatbot — design

## Problem

Argus already has four independent AI call-sites, each built during earlier days of this week's build:

- `app/ai/telegram_evaluator.py` — automatic, per inbound Telegram message (summary/next-step/draft reply/event detection)
- `app/ai/client_context.py` — on-demand "Контекст для передачи" handover brief (Клиенты)
- `app/ai/client_segmentation.py` — on-demand "AI-сводка" client segments (Клиенты)
- `app/ai/chat.py` (`run_chat`) — on-demand free-form Q&A + function-calling, used both as the floating assistant widget and the per-client chat in Мастерская's `ClientWorkspace.tsx`

Each one re-queries leads/справки/etc. from scratch. This surfaced as real user-facing confusion during the 2026-08-05 brainstorm: opening a client in Мастерская shows two separate AI voices (a static "Итог диалога" card and a Q&A chat below it) that don't share context — the chat can't see the Telegram conversation at all, only leads/справки.

Separately, the user raised two real operational gaps found during today's brainstorm:
1. Argus has no cross-stage reminder system — a manager can call a lead, get no answer, and nothing tracks that until the lead goes stale by the existing blunt "no stage change in N days" rule. There's also no client-facing "how do I use this" — anyone confused about a feature has to ask the boss.
2. `leads.stage` (the closest thing to a client pipeline) stops at `paid_reservation` — there's no representation of "deal in progress" or "contract signed" at the client/lead level, even though `units.status` has parallel-but-separate values for a similar idea.

## Scope

This spec covers, in build order (per the user's explicit priority call):

1. **Argus Brain** (`app/ai/brain.py`) — the shared context-assembly layer all AI call-sites should read from instead of their own ad hoc queries.
2. **Мастерская advisor** — merges the passive summary card + Q&A chat into one "Советник" panel, adds a proactive `coaching_tip`.
3. **Stage-based reminder system** — extends `leads.stage`, adds call-outcome logging and meeting notes, and rewrites "На сегодня" from fixed client-side rules into an AI-generated, cached, per-manager task list.
4. **Owner live summary** — an on-demand AI narrative added to the existing "Сводка" tab.
5. **"Как всё работает" help chatbot** — small, isolated, staff-only, no function-calling.

**Explicitly not in scope**: multi-tenant onboarding/self-serve setup (that's a separate go-to-market spec, not touched here), any autonomous write beyond what already exists (справка creation, etc. — all still human-confirmed), SMS/push notification delivery to managers (decided in brainstorm: stays in-app only, inside "На сегодня").

## Product decisions (from brainstorm)

1. **Argus Brain is a shared context layer, not a 5th autonomous agent.** Three focused functions (`gather_client_context`, `gather_manager_context`, `gather_company_context`), each pure data assembly — no AI call inside `brain.py` itself. The AI calls stay in the consumer modules, now fed richer, shared, consistent input. Rejected the alternative (a standalone orchestrator agent that supervises the other four) as unneeded coordination complexity at this scale (2 managers).
2. **"На сегодня" fully replaces its rule-based construction, but the underlying facts stay deterministic Python**, not AI-invented. `_gather_daily_facts()` (overdue contacts, stale leads, pending справки, today's confirmed/proposed calendar events, no-answer calls) is plain Postgres queries, same trust level as today. Only the prioritization + phrasing + judgment-based additions (e.g. "client looks ready but 2 days no contact") go through GPT-4o. This preserves the guarantee that a real overdue item can never silently vanish because the model decided not to mention it — it's always in the input set; the model's job is to rank and phrase, and it may add extra items, but the facts panel doubles as a fallback if a future audit wants to verify nothing was dropped.
3. **Cost control**: the daily task list is generated once per manager per day and cached (`daily_briefings` table), refreshed via an explicit "Обновить" button or a background regeneration once the cached copy is stale (>4h old) — never regenerated on every page load. The owner's live summary is on-demand only (button click), not polled. `coaching_tip` piggybacks on the existing per-message `telegram_evaluator` call, so it adds no new OpenAI round-trips.
4. **Meeting notes are hybrid**: Telegram-derived context is already captured automatically (`telegram_conversations.summary`); in-person meetings/calls need a manual note, prompted once a confirmed calendar event's time has passed with no note yet ("Как прошло? →", small textarea, not a whole form).
5. **Call-outcome logging is manual**: after clicking a click-to-call button, a small popover asks взял / не взял / отложил — one click, no new dependency on telephony infrastructure (Asterisk/AMI integration stays explicitly out of scope, unchanged from Day 5's decision).
6. **Client pipeline gets two new terminal stages**: `deal_in_progress`, `contract_signed`, appended to `leads.STAGES` — confirmed against the user's real Ulkan process (холодный → подбор → встреча назначена → встреча прошла → резерв → оплаченный резерв → сделка в процессе → договор подписан).
7. **Reservation deadline**: fixed 3 days from `reserved` stage entry — needs a dedicated `leads.reserved_at` column, not the generic `updated_at` (that changes on any edit to the lead, not just this specific stage transition, so it can't reliably anchor the deadline). Set once, the first time `stage` transitions to `'reserved'`.
8. **Мастерская panel gets merged now** (not deferred) since time allows and it directly addresses the "two AI voices" confusion that prompted this whole spec.
9. **Help chatbot is staff-only, in-app, behind login** — not a public marketing tool (that's separate go-to-market scope). No function-calling: it explains Argus's own features from a static knowledge system prompt, it doesn't touch business data, so it's low-risk to ship quickly.

## Architecture

### Argus Brain (`app/ai/brain.py`)

```python
def gather_client_context(client, tenant_id: str, client_id: str) -> dict:
    """leads + spravka_requests + telegram summary/last messages + meeting_notes
    for one client. Used by: client_context.py, assistant.py's chat context,
    telegram_evaluator's caller (for coaching_tip grounding)."""

def gather_manager_context(client, tenant_id: str, manager_email: str) -> dict:
    """All of one manager's clients/leads/calendar events/call outcomes today
    -- the deterministic fact set behind the daily briefing."""

def gather_company_context(client, tenant_id: str) -> dict:
    """Cross-manager rollup: leads by stage, buildings/units summary,
    справки pending, today's events across all managers."""
```

Each is a straight set of tenant-scoped Supabase queries returning plain dicts — no OpenAI calls inside this module. Consumers format and prompt however fits their own trust model (this matches how `client_context.py`/`client_segmentation.py` already work; `brain.py` just centralizes the *queries*, not the prompts).

### Мастерская advisor

- `telegram_evaluator.py`'s schema gains `coaching_tip: string` (short, tactical, e.g. "Клиент упомянул бюджет — предложи рассрочку"). Same call, same cost, persisted to a new `telegram_conversations.coaching_tip` column.
- `TelegramSummaryCard.tsx` renamed in spirit to an advisor header ("AI-советник"), shows the tip prominently.
- `ClientWorkspace.tsx`'s two stacked `glass-panel`s (summary card + `ChatThread`) merge into one panel — same components, one wrapping container, one header.
- `assistant.py::_client_context_suffix` is replaced by a call to `brain.gather_client_context()`, so the Q&A chat now sees the live Telegram summary + meeting notes, not just leads/справки.

### Stage-based reminders

**Schema changes:**
```sql
-- extend the stage check constraint
alter table leads drop constraint leads_stage_check; -- find real name dynamically, like migration 0024 did
alter table leads add constraint leads_stage_check check (
  stage in ('unsorted','matching','meeting_scheduled','meeting_held','reserved','paid_reservation','deal_in_progress','contract_signed')
);
alter table leads add column reserved_at timestamptz; -- anchor for the 3-day reservation deadline

create table call_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  lead_id uuid references leads(id),
  client_id uuid references clients(id),
  outcome text not null check (outcome in ('answered', 'no_answer', 'postponed')),
  logged_by text not null, -- manager email
  created_at timestamptz not null default now()
);

create table meeting_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  calendar_event_id uuid references calendar_events(id),
  client_id uuid references clients(id),
  note text not null,
  logged_by text not null,
  created_at timestamptz not null default now()
);

create table daily_briefings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_email text not null,
  briefing_date date not null,
  items jsonb not null, -- [{label, detail, color, source}]
  generated_at timestamptz not null default now(),
  unique (tenant_id, user_email, briefing_date)
);
```

**Reminder rules** (deterministic facts feeding the AI's daily briefing prompt, per stage):

| Stage | Trigger |
|---|---|
| `unsorted` | No first contact within 24h |
| `matching` | Latest `call_logs` row is `no_answer` → re-call reminder a few hours later; or last outbound Telegram message unanswered 2 days |
| `meeting_scheduled` | Calendar event today/tomorrow (prep reminder); event passed with no `meeting_notes` row (note prompt) |
| `meeting_held` | 2 days, no stage change |
| `reserved` | `now() > reserved_at + 3 days` |
| `paid_reservation` | 3 days, no stage change |
| `deal_in_progress` | 3 days, no stage change |
| `contract_signed` | terminal — no reminders |

- New endpoint `POST /api/leads/{id}/call-outcome` — logs a `call_logs` row, tiny popover UI after the click-to-call anchor (Лиды, Клиенты, Юниты — same three spots click-to-call already exists).
- New endpoint `POST /api/calendar/{id}/meeting-note` — logs a `meeting_notes` row; the prompt surfaces in Calendar/"На сегодня" once `event_at < now()` and `status = 'confirmed'` and no note exists yet.
- New endpoint `GET /api/brain/daily-briefing` (regenerates if stale, else returns cached) + `POST /api/brain/daily-briefing/refresh` — replaces `TodayQueue.tsx`'s client-side rule logic; frontend now fetches one already-prioritized list instead of building it from four raw endpoints.

### Owner live summary

- Existing boss-only "Сводка" tab (`AssistantPanel.tsx`) gains an AI narrative section below the existing numeric stat tiles — a button ("Спросить AI"), calls a new `POST /api/brain/company-summary`, one-shot GPT-4o call over `gather_company_context()`. Not cached (low call volume expected — one boss, on-demand), but debounced client-side against rapid re-clicks.

### "Как всё работает" help chatbot

- New topbar icon (next to theme/search), opens a `ChatThread`-reusing panel with a new `HELP_SYSTEM_PROMPT` (static, describes Argus's own sections/features — no function-calling, no live business data).
- New conversation "kind" or just a distinguishing flag on the existing `conversations` table (`purpose: 'help'` vs default) so history doesn't mix with client-workspace chats.
- Staff-only (behind login), available from any screen.

## Trust/safety notes

- Nothing here introduces a new autonomous write to business records. `call_logs`/`meeting_notes` rows are always human-typed, triggered by a human action (click-to-call, or the post-meeting prompt) — the AI never logs a call outcome or writes a meeting note itself.
- `daily_briefings` and the company summary are advisory text for humans to read, not actions executed on their behalf — consistent with the existing "propose then confirm" pattern used for справки and Telegram drafts, just with nothing to confirm because nothing gets executed.
- Cost: `coaching_tip` adds zero new calls (folded into the existing per-message evaluator call). Daily briefing capped at 1 real generation per manager per ~4h window. Company summary and help chatbot are both low-frequency, single-user (boss) or occasional (staff Q&A) surfaces — no realistic abuse path found during the Day 7 security pass (see week plan) that this spec would need to defend against beyond normal auth.

## Explicitly deferred

- Public-facing (pre-login) version of the help chatbot for prospects — that's go-to-market scope (Sat-Sun), not this spec.
- Asterisk/AMI-based automatic call-outcome detection — stays manual, per the Day 5 telephony decision, unchanged.
- Multi-agent Telegram Business support, SMS delivery of reminders — out of scope, not requested this round.
