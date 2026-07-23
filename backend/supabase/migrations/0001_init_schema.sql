-- Argus (Italiano Vero pilot) — fresh schema on the reclaimed pfmzciaijhqxzqcljvsx
-- project. Drops the old, confirmed-stale Cortège tables first (Lead Generation's
-- `leads` work was confirmed stopped and safe to lose 2026-07-23), then builds
-- Argus's own schema from scratch.

-- ============================================================
-- 1) DROP old Cortège-era tables (leftover from before Cortège's dedicated project)
-- ============================================================
drop table if exists public.knowledge_gaps cascade;
drop table if exists public.broadcasts cascade;
drop table if exists public.reviews cascade;
drop table if exists public.escalations cascade;
drop table if exists public.availability_cache cascade;
drop table if exists public.client_profiles cascade;
drop table if exists public.messages cascade;
drop table if exists public.conversations cascade;
drop table if exists public.company_profile cascade;
drop table if exists public.cortege_leads cascade;
drop table if exists public.leads cascade;
drop table if exists public.tenants cascade;

-- ============================================================
-- 2) Argus schema
-- ============================================================

create extension if not exists "pgcrypto";

-- One tenant = one developer company (Ulkan Development first; designed so a
-- second real-estate developer could onboard later, same multi-tenant pattern
-- as Tender Agent/Cortège).
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,               -- "Ulkan Development"
  owner_email text unique,          -- self-serve login, mirrors Cortège/Tender Agent's pattern
  created_at timestamptz not null default now()
);

-- A building/mini-project under a tenant. Ulkan's real 5: Milano, Roma, Neapol,
-- Venice, Florencia (Italiano Vero project).
create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,                -- "Milano"
  project_name text,                 -- "Italiano Vero" — the umbrella project name
  status text not null default 'construction' check (status in ('construction', 'nearly_complete', 'complete')),
  logo_url text,
  created_at timestamptz not null default now()
);

-- Individual sellable units. Mirrors Macro CRM's "chess grid" fields directly —
-- see PLANNING.md for the real screenshot this was modeled on.
create table public.units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_number int not null,
  entrance int,                       -- Подъезд
  floor int not null,
  room_type text,                     -- "Студия", "2-комнатная", ...
  area_m2 numeric(8,2) not null,
  ceiling_height_m numeric(4,2),
  price_per_m2_usd numeric(10,2) not null,
  status text not null default 'for_sale' check (
    status in ('for_sale', 'reserved', 'paid_reservation', 'deal_in_progress', 'deal_completed', 'marketing_reserve')
  ),
  assigned_manager text,
  client_name text,
  client_phone text,
  floor_plan_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, unit_number)
);

-- Leads — mirrors Macro CRM's real pipeline stages exactly (see the Заявки
-- board screenshot in PLANNING.md). Facebook-ads-driven, not a DM concierge.
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  building_id uuid references public.buildings(id),   -- nullable: lead may not have picked a building yet
  phone text not null,
  source text,                         -- "Facebook", "Телефония", ...
  buy_intent text,                     -- "Buy: apartment, city Ташкент"
  stage text not null default 'unsorted' check (
    stage in ('unsorted', 'matching', 'meeting_scheduled', 'meeting_held', 'reserved', 'paid_reservation')
  ),
  assigned_manager text,
  external_ticket_ref text,            -- Macro's own ticket id, e.g. "#5534109", kept for cross-reference only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pricing/negotiation bounds — what a rep can offer without escalating.
-- Owner's explicit ask (#3): reps currently quote an anchor price then stall
-- on "let me ask my boss." This is the AI-visible bounds table for that.
create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  building_id uuid references public.buildings(id),
  room_type text,                       -- null = applies to all room types in the building
  max_discount_pct numeric(5,2) not null default 0,  -- rep can offer up to this % off without escalating
  active_promo_name text,
  active_promo_discount_pct numeric(5,2),
  exchange_rate_sum numeric(12,2) not null,  -- курс, updated daily
  updated_at timestamptz not null default now()
);

-- Справка/approval requests — the boss-approval workflow (#1 + #3 combined).
-- A rep requests a price/terms for a specific unit+client; if it's within
-- pricing_rules bounds it can auto-approve, otherwise it queues for the boss.
create table public.spravka_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  client_name text not null,
  client_phone text not null,
  requested_by text not null,           -- rep name
  is_full_payment boolean not null default true,
  installment_months int,
  down_payment_pct numeric(5,2),
  balloon_months int,
  balloon_monthly_payment_usd numeric(10,2),
  requested_discount_pct numeric(5,2) not null default 0,
  status text not null default 'pending' check (status in ('auto_approved', 'pending', 'approved', 'rejected')),
  approved_by text,
  approved_at timestamptz,
  generated_file_url text,              -- the generated Справка .xlsx, once approved
  created_at timestamptz not null default now()
);

create index on public.units (tenant_id, building_id, status);
create index on public.leads (tenant_id, stage);
create index on public.spravka_requests (tenant_id, status);
