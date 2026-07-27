-- Демо-данные для презентации Платежей -- показывает реальный вид страницы
-- (просрочено / скоро / ожидается / оплачено) без ожидания, пока у Ulkan
-- появится первая настоящая одобренная рассрочка. Помечено так, чтобы легко
-- найти и удалить позже: requested_by/approved_by = 'demo@ulkan.local',
-- телефоны клиентов в диапазоне +998901234601..603 (реальный сид лидов
-- в 0009 занимает 501..515, коллизий нет).
--
-- payment_schedule.status намеренно всегда 'pending', даже для прошедших
-- дат -- "overdue" вычисляется на чтении в payments.py, а не хранится,
-- ровно как и для настоящих графиков.

do $$
declare
  v_tenant_id uuid;
  v_milano_unit uuid;
  v_roma_unit uuid;
  v_venice_unit uuid;
  v_client1 uuid;
  v_client2 uuid;
  v_client3 uuid;
  v_spravka1 uuid;
  v_spravka2 uuid;
  v_spravka3 uuid;
begin
  select id into v_tenant_id from public.tenants where name = 'Ulkan Development';
  if v_tenant_id is null then return; end if;

  select u.id into v_milano_unit from public.units u join public.buildings b on b.id = u.building_id
    where b.tenant_id = v_tenant_id and b.name = 'Milano' and u.status = 'for_sale' order by u.floor limit 1;
  select u.id into v_roma_unit from public.units u join public.buildings b on b.id = u.building_id
    where b.tenant_id = v_tenant_id and b.name = 'Roma' and u.status = 'for_sale' order by u.floor limit 1;
  select u.id into v_venice_unit from public.units u join public.buildings b on b.id = u.building_id
    where b.tenant_id = v_tenant_id and b.name = 'Venice' and u.status = 'for_sale' order by u.floor limit 1;

  if v_milano_unit is null or v_roma_unit is null or v_venice_unit is null then
    return; -- expected seed buildings/units not present -- skip rather than fail
  end if;

  if exists (select 1 from public.clients where tenant_id = v_tenant_id and phone = '+998901234601') then
    return; -- already seeded
  end if;

  insert into public.clients (tenant_id, name, phone) values (v_tenant_id, 'Азиз Каримов', '+998901234601') returning id into v_client1;
  insert into public.clients (tenant_id, name, phone) values (v_tenant_id, 'Дилноза Юсупова', '+998901234602') returning id into v_client2;
  insert into public.clients (tenant_id, name, phone) values (v_tenant_id, 'Бахтиёр Назаров', '+998901234603') returning id into v_client3;

  insert into public.spravka_requests
    (tenant_id, unit_id, client_id, client_name, client_phone, requested_by, plan_type, is_full_payment, installment_months, down_payment_pct, status, approved_by, approved_at, created_at)
  values
    (v_tenant_id, v_milano_unit, v_client1, 'Азиз Каримов', '+998901234601', 'demo@ulkan.local', 'installment_12', false, 12, 30, 'approved', 'demo@ulkan.local', now() - interval '40 days', now() - interval '40 days')
  returning id into v_spravka1;

  insert into public.spravka_requests
    (tenant_id, unit_id, client_id, client_name, client_phone, requested_by, plan_type, is_full_payment, installment_months, down_payment_pct, status, approved_by, approved_at, created_at)
  values
    (v_tenant_id, v_roma_unit, v_client2, 'Дилноза Юсупова', '+998901234602', 'demo@ulkan.local', 'installment_6', false, 6, 40, 'approved', 'demo@ulkan.local', now() - interval '70 days', now() - interval '70 days')
  returning id into v_spravka2;

  insert into public.spravka_requests
    (tenant_id, unit_id, client_id, client_name, client_phone, requested_by, plan_type, is_full_payment, installment_months, down_payment_pct, status, approved_by, approved_at, created_at)
  values
    (v_tenant_id, v_venice_unit, v_client3, 'Бахтиёр Назаров', '+998901234603', 'demo@ulkan.local', 'installment_24', false, 24, 20, 'approved', 'demo@ulkan.local', now() - interval '10 days', now() - interval '10 days')
  returning id into v_spravka3;

  -- Deal 1: down paid + 1 paid installment, 1 overdue, 1 due soon, 1 future
  insert into public.payment_schedule (tenant_id, spravka_request_id, installment_number, label, due_date, amount_usd, status, paid_at) values
    (v_tenant_id, v_spravka1, 0, 'Первый взнос', current_date - 40, 15000, 'paid', now() - interval '40 days'),
    (v_tenant_id, v_spravka1, 1, 'Платёж 1/12', current_date - 10, 2900, 'paid', now() - interval '9 days'),
    (v_tenant_id, v_spravka1, 2, 'Платёж 2/12', current_date - 3, 2900, 'pending', null),
    (v_tenant_id, v_spravka1, 3, 'Платёж 3/12', current_date + 2, 2900, 'pending', null),
    (v_tenant_id, v_spravka1, 4, 'Платёж 4/12', current_date + 32, 2900, 'pending', null);

  -- Deal 2: down paid + 1 paid installment, 1 overdue, 1 future
  insert into public.payment_schedule (tenant_id, spravka_request_id, installment_number, label, due_date, amount_usd, status, paid_at) values
    (v_tenant_id, v_spravka2, 0, 'Первый взнос', current_date - 70, 12000, 'paid', now() - interval '70 days'),
    (v_tenant_id, v_spravka2, 1, 'Платёж 1/6', current_date - 40, 3000, 'paid', now() - interval '39 days'),
    (v_tenant_id, v_spravka2, 2, 'Платёж 2/6', current_date - 10, 3000, 'pending', null),
    (v_tenant_id, v_spravka2, 3, 'Платёж 3/6', current_date + 20, 3000, 'pending', null);

  -- Deal 3: fresh deal, only down payment paid, everything else ahead
  insert into public.payment_schedule (tenant_id, spravka_request_id, installment_number, label, due_date, amount_usd, status, paid_at) values
    (v_tenant_id, v_spravka3, 0, 'Первый взнос', current_date - 10, 9000, 'paid', now() - interval '10 days'),
    (v_tenant_id, v_spravka3, 1, 'Платёж 1/24', current_date + 4, 1500, 'pending', null),
    (v_tenant_id, v_spravka3, 2, 'Платёж 2/24', current_date + 34, 1500, 'pending', null);
end $$;
