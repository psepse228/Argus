-- Replaces every real Ulkan Development / Italiano Vero business record
-- (buildings, units, leads, clients, справки, payments) with clearly
-- fictional demo data, so the whole app can be shown end to end without
-- resembling the real pilot client's actual data. Does NOT touch tenants
-- or tenant_users -- those are login-critical (real Google email → tenant
-- mapping, see app/auth/tenant.py) and are never displayed to the frontend
-- anyway, so there's nothing "real" in them worth hiding.
--
-- 5 apartments per building, 5 buildings -- down from the ~150-unit real
-- seed. Deletes in FK-safe order (children before parents), since several
-- of the older tables were defined without on-delete-cascade.

do $$
declare
  v_tenant_id uuid;
begin
  select id into v_tenant_id from public.tenants limit 1;
  if v_tenant_id is null then return; end if;

  delete from public.payment_schedule where tenant_id = v_tenant_id;
  delete from public.spravka_requests where tenant_id = v_tenant_id;
  delete from public.messages where conversation_id in (select id from public.conversations where tenant_id = v_tenant_id);
  delete from public.conversations where tenant_id = v_tenant_id;
  delete from public.workspace_clients where tenant_id = v_tenant_id;
  delete from public.leads where tenant_id = v_tenant_id;
  delete from public.clients where tenant_id = v_tenant_id;
  delete from public.pricing_rules where tenant_id = v_tenant_id;
  delete from public.payment_plan_rates where tenant_id = v_tenant_id;
  delete from public.units where tenant_id = v_tenant_id;
  delete from public.buildings where tenant_id = v_tenant_id;
end $$;

-- Fake project: "Horizon Bay" by "Meridian Group" -- five buildings named
-- after stars/constellations, nothing resembling Italiano Vero/Ulkan.
insert into public.buildings (tenant_id, name, project_name, status)
select t.id, b.name, 'Horizon Bay', b.status
from public.tenants t
cross join (values
  ('Atlas', 'nearly_complete'),
  ('Vega', 'construction'),
  ('Orion', 'construction'),
  ('Lyra', 'complete'),
  ('Nova', 'construction')
) as b(name, status);

-- 5 units per building -- a small, varied spread of floor/room type/status
-- so every UI (chess grid, list, filters) has something real to show.
insert into public.units (tenant_id, building_id, unit_number, entrance, floor, room_type, area_m2, ceiling_height_m, price_per_m2_usd, status)
select t.id, b.id, u.unit_number, 1, u.floor, u.room_type, u.area_m2, 2.8, u.price_per_m2_usd, u.status
from public.tenants t
join public.buildings b on b.tenant_id = t.id
cross join lateral (
  values
    (b.name || '-101', 1, 'Студия', 38.0, 1450.0, 'for_sale'),
    (b.name || '-102', 2, '1-комнатная', 52.0, 1500.0, 'for_sale'),
    (b.name || '-103', 3, '2-комнатная', 71.0, 1550.0, 'reserved'),
    (b.name || '-104', 4, '2-комнатная', 74.5, 1600.0, 'for_sale'),
    (b.name || '-105', 5, '3-комнатная', 96.0, 1650.0, 'deal_completed')
) as u(unit_number, floor, room_type, area_m2, price_per_m2_usd, status);

-- курс + negotiation bounds per building.
insert into public.pricing_rules (tenant_id, building_id, room_type, max_discount_pct, exchange_rate_sum)
select t.id, b.id, null, 5.0, 12300.0
from public.tenants t
join public.buildings b on b.tenant_id = t.id;

-- Real payment-plan price table, all 4 plans, all 5 buildings (the old real
-- seed only ever had Milano populated -- this demo covers every building).
insert into public.payment_plan_rates (tenant_id, building_id, plan_type, price_per_m2_usd)
select t.id, b.id, v.plan_type, v.price_per_m2_usd + b_offset.price_bump
from public.tenants t
join public.buildings b on b.tenant_id = t.id
cross join (values
  ('cash', 1400.0), ('installment_6', 1470.0), ('installment_12', 1520.0), ('installment_24', 1580.0)
) as v(plan_type, price_per_m2_usd)
join (values ('Atlas', 0.0), ('Vega', 20.0), ('Orion', -10.0), ('Lyra', 40.0), ('Nova', 10.0)) as b_offset(name, price_bump)
  on b_offset.name = b.name;

-- Fake leads across the real pipeline stages.
insert into public.leads (tenant_id, building_id, phone, source, buy_intent, stage, assigned_manager, created_at)
select t.id, bl.id, l.phone, l.source, l.buy_intent, l.stage, l.assigned_manager, now() - (l.days_ago || ' days')::interval
from public.tenants t
cross join (
  values
    ('+998911110001', 'Facebook', 'Buy: студия, budget до $30k', 'unsorted', null::text, 1, 'Atlas'),
    ('+998911110002', 'Instagram', 'Интересует 2-комнатная', 'unsorted', null::text, 2, 'Vega'),
    ('+998911110003', 'Facebook', 'Buy: apartment, рассрочка', 'matching', 'Азиз Собиров', 3, 'Atlas'),
    ('+998911110004', 'Instagram', 'Ищет 3-комнатную с видом', 'matching', 'Азиз Собиров', 4, 'Lyra'),
    ('+998911110005', 'Телефония', 'Повторный звонок, уточняет рассрочку', 'meeting_scheduled', 'Азиз Собиров', 5, 'Orion'),
    ('+998911110006', 'Facebook', 'Хочет посмотреть Nova лично', 'meeting_held', 'Азиз Собиров', 8, 'Nova'),
    ('+998911110007', 'Instagram', 'Buy: studio, готов к брони', 'reserved', 'Азиз Собиров', 13, 'Vega'),
    ('+998911110008', 'Facebook', 'Забронировал юнит, оплатил бронь', 'paid_reservation', 'Азиз Собиров', 20, 'Atlas')
) as l(phone, source, buy_intent, stage, assigned_manager, days_ago, building_name)
join public.buildings bl on bl.tenant_id = t.id and bl.name = l.building_name;

-- Fake named clients (a few real-looking demo people) + auto-backfill
-- nameless clients for every lead phone, same pattern the real seed used.
insert into public.clients (tenant_id, name, phone)
select t.id, c.name, c.phone
from public.tenants t
cross join (values
  ('Дилшод Каримов', '+998911110009'),
  ('Нигора Юсупова', '+998911110010'),
  ('Сардор Тошев', '+998911110011')
) as c(name, phone);

insert into public.clients (tenant_id, name, phone)
select distinct t.id, null, l.phone
from public.tenants t
join public.leads l on l.tenant_id = t.id
on conflict (tenant_id, phone) do nothing;

update public.leads l set client_id = c.id
from public.clients c
where c.tenant_id = l.tenant_id and c.phone = l.phone and l.client_id is null;

-- A handful of справки with varied statuses (including one with a
-- requested_price_per_m2_usd override, to demo that feature) + payment
-- schedules with a real spread of paid/pending/overdue.
do $$
declare
  v_tenant_id uuid;
  v_unit_atlas103 uuid;
  v_unit_vega103 uuid;
  v_unit_lyra104 uuid;
  v_client1 uuid;
  v_client2 uuid;
  v_client3 uuid;
  v_spravka1 uuid;
  v_spravka2 uuid;
  v_spravka3 uuid;
begin
  select id into v_tenant_id from public.tenants limit 1;
  select u.id into v_unit_atlas103 from public.units u join public.buildings b on b.id = u.building_id where b.tenant_id = v_tenant_id and b.name = 'Atlas' and u.unit_number = 'Atlas-103';
  select u.id into v_unit_vega103 from public.units u join public.buildings b on b.id = u.building_id where b.tenant_id = v_tenant_id and b.name = 'Vega' and u.unit_number = 'Vega-103';
  select u.id into v_unit_lyra104 from public.units u join public.buildings b on b.id = u.building_id where b.tenant_id = v_tenant_id and b.name = 'Lyra' and u.unit_number = 'Lyra-104';
  select id into v_client1 from public.clients where tenant_id = v_tenant_id and phone = '+998911110009';
  select id into v_client2 from public.clients where tenant_id = v_tenant_id and phone = '+998911110010';
  select id into v_client3 from public.clients where tenant_id = v_tenant_id and phone = '+998911110011';

  insert into public.spravka_requests (tenant_id, unit_id, client_id, client_name, client_phone, requested_by, plan_type, is_full_payment, installment_months, down_payment_pct, requested_price_per_m2_usd, status, created_at)
  values (v_tenant_id, v_unit_atlas103, v_client1, 'Дилшод Каримов', '+998911110009', 'demo@meridian.local', 'installment_12', false, 12, 30, null, 'pending', now() - interval '2 days')
  returning id into v_spravka1;

  insert into public.spravka_requests (tenant_id, unit_id, client_id, client_name, client_phone, requested_by, plan_type, is_full_payment, installment_months, down_payment_pct, requested_price_per_m2_usd, status, approved_by, approved_at, created_at)
  values (v_tenant_id, v_unit_vega103, v_client2, 'Нигора Юсупова', '+998911110010', 'demo@meridian.local', 'installment_6', false, 6, 40, 1450.0, 'approved', 'demo@meridian.local', now() - interval '30 days', now() - interval '30 days')
  returning id into v_spravka2;

  insert into public.spravka_requests (tenant_id, unit_id, client_id, client_name, client_phone, requested_by, plan_type, is_full_payment, installment_months, down_payment_pct, requested_price_per_m2_usd, status, created_at)
  values (v_tenant_id, v_unit_lyra104, v_client3, 'Сардор Тошев', '+998911110011', 'demo@meridian.local', 'installment_24', false, 24, 20, null, 'rejected', now() - interval '5 days')
  returning id into v_spravka3;

  -- Payment schedule only for the approved deal -- matches the real
  -- generate_schedule() behavior (schedules are created on approval).
  insert into public.payment_schedule (tenant_id, spravka_request_id, installment_number, label, due_date, amount_usd, status, paid_at) values
    (v_tenant_id, v_spravka2, 0, 'Первый взнос', current_date - 30, 8000, 'paid', now() - interval '30 days'),
    (v_tenant_id, v_spravka2, 1, 'Платёж 1/6', current_date - 8, 1900, 'paid', now() - interval '7 days'),
    (v_tenant_id, v_spravka2, 2, 'Платёж 2/6', current_date - 2, 1900, 'pending', null),
    (v_tenant_id, v_spravka2, 3, 'Платёж 3/6', current_date + 3, 1900, 'pending', null),
    (v_tenant_id, v_spravka2, 4, 'Платёж 4/6', current_date + 33, 1900, 'pending', null);
end $$;
