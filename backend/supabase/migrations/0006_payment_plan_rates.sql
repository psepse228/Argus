-- Replaces the flat max_discount_pct model. The chess-grid price is an
-- anchor/illusion price — the real price is a fixed table lookup per
-- payment-plan type (shorter term = better rate), not a rep-negotiated %.
-- The rep picks a plan, the system looks up the real rate, generates the
-- Справка immediately, and the boss reviews/confirms or rejects it after —
-- not a pre-approval gate.

create table public.payment_plan_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  plan_type text not null,   -- 'cash', 'installment_6', 'installment_12', 'installment_24'
  price_per_m2_usd numeric(10,2) not null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, building_id, plan_type)
);

-- Milano: only 6-month ($1850) and 24-month ($1950) are real numbers from the
-- owner. 12-month and cash are PLACEHOLDERS pending the real figures — flagged
-- clearly, not to be trusted for the actual demo until confirmed.
insert into public.payment_plan_rates (tenant_id, building_id, plan_type, price_per_m2_usd)
select t.id, b.id, v.plan_type, v.price
from public.tenants t
join public.buildings b on b.tenant_id = t.id and b.name = 'Milano'
cross join (values
  ('installment_6', 1850.00),
  ('installment_12', 1900.00),   -- PLACEHOLDER — interpolated, not real, confirm with owner
  ('installment_24', 1950.00),
  ('cash', 2578.00)               -- PLACEHOLDER — assumed same as anchor, confirm with owner
) as v(plan_type, price)
where t.name = 'Ulkan Development';
