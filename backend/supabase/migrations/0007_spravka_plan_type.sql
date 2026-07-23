-- Missed adding this column when spravka_requests' logic moved from a
-- rep-negotiated discount% to a fixed payment_plan_rates lookup.
alter table public.spravka_requests add column if not exists plan_type text;
