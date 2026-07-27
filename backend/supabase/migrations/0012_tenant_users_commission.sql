-- Комиссии: rep commission tracking. A flat, boss-editable percentage per
-- agent applied to their collected (paid) installments -- not a real payroll
-- system, just the number the boss asked to see next to each agent's name.
alter table public.tenant_users add column commission_pct numeric(5,2) not null default 3.00;
