-- Day 6: real Macro has a 7th chess-grid status Argus never had --
-- "Маркетинговая сделка" (marketing_deal), distinct from marketing_reserve
-- (Маркетинговый резерв, a unit held back from sale) and deal_completed
-- (Сделка проведена, a normal completed sale) -- found from the real
-- Шахматка screenshot 2026-08-02.
--
-- The original check constraint's name wasn't set explicitly in
-- 0001_init_schema.sql, so Postgres auto-named it -- find and drop it
-- dynamically rather than guess, then add a normally-named one back with the
-- new value included.
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.units'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%for_sale%';
  if con_name is not null then
    execute format('alter table public.units drop constraint %I', con_name);
  end if;
end $$;

alter table public.units add constraint units_status_check check (
  status in (
    'for_sale', 'reserved', 'paid_reservation', 'deal_in_progress',
    'deal_completed', 'marketing_reserve', 'marketing_deal'
  )
);
