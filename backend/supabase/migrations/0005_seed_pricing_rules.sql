-- Negotiation bounds per building — reps can offer up to max_discount_pct off
-- without escalating to the boss. 5% is a placeholder starting bound, not a
-- number Ulkan gave us — confirm the real threshold with them before the demo
-- is treated as reflecting their actual policy.
insert into public.pricing_rules (tenant_id, building_id, room_type, max_discount_pct, exchange_rate_sum)
select t.id, b.id, null, 5.0, 12200.0
from public.tenants t
join public.buildings b on b.tenant_id = t.id
where t.name = 'Ulkan Development';
