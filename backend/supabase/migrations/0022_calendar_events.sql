-- Calendar section (Day 4): fed by the AI monitor's proposals (parsed from
-- Telegram messages, e.g. "I'll come Wednesday") and manual entries. Proposals
-- are materialized as real rows immediately (status='proposed'), same
-- review-after posture as spravka_requests -- a manager reviews/edits/confirms
-- or dismisses, nothing here gets silently auto-confirmed.
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  telegram_conversation_id uuid references public.telegram_conversations(id) on delete set null,
  title text not null,
  event_at timestamptz not null,
  note text,
  source text not null default 'manual' check (source in ('manual', 'monitor')),
  status text not null default 'confirmed' check (status in ('proposed', 'confirmed', 'dismissed')),
  created_by text,  -- manager email for manual entries / confirmations; null while still an unconfirmed monitor proposal
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.calendar_events (tenant_id, event_at);
create index on public.calendar_events (tenant_id, status);
