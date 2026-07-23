-- Argus needs multiple named users per tenant with different roles (boss vs.
-- sales agent) — unlike Cortège's single-owner_email-per-tenant model or
-- Tender Agent's tenant_users (real precedent for "a table of users", but
-- without a role distinction — Argus is the first Solura product needing one).

create table public.tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null check (role in ('boss', 'sales_agent')),
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create index on public.tenant_users (email);

-- seed: Madina (boss) + Mukhammadrizo (the sales manager seen throughout the
-- real Excel samples and CRM screenshots)
insert into public.tenant_users (tenant_id, email, name, role)
select id, 'madina@ulkan.local', 'Madina', 'boss' from public.tenants where name = 'Ulkan Development'
union all
select id, 'muhammadrizo@ulkan.local', 'Мухаммадризо', 'sales_agent' from public.tenants where name = 'Ulkan Development';
