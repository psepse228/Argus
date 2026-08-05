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
