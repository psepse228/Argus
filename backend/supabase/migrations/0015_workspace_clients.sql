-- Мастерская: the set of client profiles a rep has explicitly chosen to
-- actively work on (per the owner's ask to replace the old standalone
-- Справки tab with a client-centric workspace). Per-user, not per-tenant --
-- each rep curates their own working set, and the boss can pin whoever they
-- need to check in on without affecting what a rep sees.
create table public.workspace_clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_email text not null,
  added_at timestamptz not null default now(),
  unique (tenant_id, client_id, user_email)
);

create index on public.workspace_clients (tenant_id, user_email);
