-- UI/UX audit (2026-08): Argus Brain's "is anything urgent" signal disagreed
-- with Обзор's own справки count and Calendar's "Требуют подтверждения" --
-- brain_items only covered leads/notes/aging справки/promoted ai_events, not
-- a fresh (non-aging) pending справка or an unconfirmed AI-detected meeting.
-- Two new deterministic kinds close that gap: 'unconfirmed_event' (a
-- calendar_events row still at status='proposed' -- same list Calendar's own
-- "Требуют подтверждения" section shows, no age cutoff) and
-- 'pending_spravka_approval' (any pending справка tenant-wide, assigned to
-- the boss, since approval is a boss-only action -- distinct from the
-- existing 'pending_spravka_aging', which nudges the REQUESTING manager
-- after 2+ days).
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.brain_items'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%stale_lead%';
  if con_name is not null then
    execute format('alter table public.brain_items drop constraint %I', con_name);
  end if;
end $$;

alter table public.brain_items add constraint brain_items_kind_check check (
  kind in (
    'stale_lead', 'missing_note', 'pending_spravka_aging', 'coaching_tip', 'event_proposed',
    'unconfirmed_event', 'pending_spravka_approval'
  )
);
