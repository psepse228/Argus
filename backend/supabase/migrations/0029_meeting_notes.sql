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
