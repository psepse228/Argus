-- Argus Brain, unified: the live, actionable queue behind "Argus Brain
-- alive" (2026-08-06 brainstorm). ai_events (0028) stays exactly what it
-- is -- a permanent, append-only audit log of what Brain has done.
-- brain_items is the other half: what Brain currently wants a manager to
-- act on. Each row has a stable identity (kind + dedupe_key, tied back to
-- the real record that generated it -- a lead, a calendar event, a
-- справка, or an existing ai_events row for coaching_tip/event_proposed)
-- so a daily regeneration can diff against it: leave a dismissed/snoozed/
-- done item alone, auto-resolve an open item whose underlying fact
-- disappeared, upsert everything else. Without this identity, "dismiss"
-- would just get silently undone by tomorrow's regeneration.
create table public.brain_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  assigned_to text not null,  -- manager email; a boss's view unions every manager's rows, nothing stored specially for boss
  client_id uuid references public.clients(id) on delete cascade,
  kind text not null check (kind in (
    'stale_lead', 'missing_note', 'pending_spravka_aging', 'coaching_tip', 'event_proposed'
  )),
  dedupe_key text not null,  -- e.g. 'leads:<id>', 'calendar_events:<id>', 'spravka_requests:<id>', 'ai_events:<id>'
  summary text not null,
  detail text,
  priority text not null default 'normal' check (priority in ('high', 'normal')),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed', 'snoozed')),
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (tenant_id, assigned_to, kind, dedupe_key)
);

create index on public.brain_items (tenant_id, assigned_to, status);
create index on public.brain_items (tenant_id, status);
