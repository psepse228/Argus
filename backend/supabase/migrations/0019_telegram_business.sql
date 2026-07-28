-- Real Telegram Business integration for Мастерская (see
-- docs/superpowers/specs/2026-07-28-telegram-business-integration-design.md).
-- Replaces the scripted TelegramPreviewModal fake demo with a real,
-- one-manager-for-now Telegram Business connection.

create table public.telegram_business_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  manager_email text not null,
  business_connection_id text not null,
  telegram_user_id bigint not null,
  is_enabled boolean not null default true,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  -- Global uniqueness, not just per-tenant -- the webhook resolves a
  -- connection by business_connection_id alone (no tenant context exists
  -- at that point), so this ID must be unambiguous across every tenant,
  -- not just within one, or a message could get filed under the wrong
  -- tenant if two connections ever shared an id (e.g. an operator mistake
  -- during this pilot's manual setup).
  unique (business_connection_id)
);

create table public.telegram_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.telegram_business_connections(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  telegram_chat_id bigint not null,
  telegram_first_name text,
  telegram_username text,
  summary text,
  next_step_suggestion text,
  draft_reply text,
  draft_generated_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (connection_id, telegram_chat_id)
);
create index on public.telegram_conversations (tenant_id, client_id);
create index on public.telegram_conversations (tenant_id, last_message_at desc);

create table public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.telegram_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  content text not null,
  telegram_message_id bigint,
  sent_by text,
  created_at timestamptz not null default now()
);
create index on public.telegram_messages (conversation_id, created_at);
