-- Client identity + persisted assistant conversations.
--
-- Until now a "client" was just free-text (name, phone) duplicated
-- independently on leads and spravka_requests, with no way to see one
-- person's full history in one place. This introduces a real client
-- entity both tables link to, plus persisted multi-thread conversations
-- (the previous Ассистент chat was pure React state -- gone on refresh,
-- and only ever one thread). A conversation with client_id set is that
-- client's own profile-chat; client_id null is a general assistant chat.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text,                      -- nullable -- leads only ever had a phone, no name
  phone text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, phone)
);

alter table public.leads add column client_id uuid references public.clients(id);
alter table public.spravka_requests add column client_id uuid references public.clients(id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_email text not null,                                   -- which rep/boss owns this thread
  client_id uuid references public.clients(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  events jsonb,
  created_at timestamptz not null default now()
);

create index on public.clients (tenant_id, phone);
create index on public.conversations (tenant_id, user_email, client_id);
create index on public.messages (conversation_id, created_at);

-- Backfill: one client row per distinct phone seen across leads and
-- spravka_requests, preferring a real name from spravka_requests (leads
-- never had one), then link both tables back to it.
insert into public.clients (tenant_id, name, phone)
select distinct on (tenant_id, phone) tenant_id, name, phone
from (
  select tenant_id, client_phone as phone, client_name as name, 1 as pref
  from public.spravka_requests
  union all
  select tenant_id, phone, null, 2 as pref
  from public.leads
) x
order by tenant_id, phone, pref
on conflict (tenant_id, phone) do nothing;

update public.leads l
set client_id = c.id
from public.clients c
where c.tenant_id = l.tenant_id and c.phone = l.phone and l.client_id is null;

update public.spravka_requests s
set client_id = c.id
from public.clients c
where c.tenant_id = s.tenant_id and c.phone = s.client_phone and s.client_id is null;
