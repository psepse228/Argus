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
