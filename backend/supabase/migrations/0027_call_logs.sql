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
