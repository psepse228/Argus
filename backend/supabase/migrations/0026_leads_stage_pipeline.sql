-- Argus Brain Phase 2a: the client pipeline (leads.stage) stopped at
-- paid_reservation -- there was no way to represent "deal in progress" or
-- "contract signed" at all, even though units.status has had parallel
-- values (deal_in_progress/deal_completed) since day one. Confirmed against
-- the real Ulkan process during the 2026-08-05 brainstorm: холодный ->
-- подбор -> встреча назначена -> встреча прошла -> резерв -> оплаченный
-- резерв -> сделка в процессе -> договор подписан.
--
-- The original check constraint's name wasn't set explicitly in
-- 0001_init_schema.sql (same situation as units.status, fixed in migration
-- 0024) -- find and drop it dynamically rather than guess.
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.leads'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%unsorted%';
  if con_name is not null then
    execute format('alter table public.leads drop constraint %I', con_name);
  end if;
end $$;

alter table public.leads add constraint leads_stage_check check (
  stage in (
    'unsorted', 'matching', 'meeting_scheduled', 'meeting_held',
    'reserved', 'paid_reservation', 'deal_in_progress', 'contract_signed'
  )
);

-- Anchor for the 3-day reservation-expiry reminder (Phase 2b) -- set once,
-- the first time a lead's stage transitions to 'reserved' (see
-- backend/app/routers/leads.py::update_lead_stage). Not the same as the
-- generic `updated_at`, which changes on any edit to the lead, not just
-- this specific transition.
alter table public.leads add column reserved_at timestamptz;
