-- Demo leads so the Лиды board and dashboard have real numbers to look at
-- (the table was live but empty — real Facebook-ads leads haven't been piped
-- in yet, see leads.py). Distributed across all 6 real pipeline stages and
-- across buildings/managers, phone numbers in the +998 (Uzbekistan) format
-- matching the rest of the seed data.

insert into public.leads (tenant_id, building_id, phone, source, buy_intent, stage, assigned_manager, created_at)
select b.id, b.building_id, b.phone, b.source, b.buy_intent, b.stage, b.assigned_manager, now() - (b.days_ago || ' days')::interval
from (
  select t.id, bl.id as building_id, l.phone, l.source, l.buy_intent, l.stage, l.assigned_manager, l.days_ago, l.building_name
  from public.tenants t
  cross join (
    values
      ('+998901234501', 'Facebook', 'Buy: apartment, city Ташкент',        'unsorted',          null::text,      1,  'Milano'),
      ('+998901234502', 'Facebook', 'Buy: studio, budget до $30k',          'unsorted',          null::text,      1,  'Roma'),
      ('+998901234503', 'Instagram','Интересует 2-комнатная',               'unsorted',          null::text,      2,  'Milano'),
      ('+998901234504', 'Телефония','Звонок с сайта, хочет узнать цены',    'unsorted',          null::text,      2,  'Neapol'),
      ('+998901234505', 'Facebook', 'Buy: apartment, rassrochka',           'matching',          'Мухаммадризо',  3,  'Milano'),
      ('+998901234506', 'Instagram','Ищет 3-комнатную с видом',             'matching',          'Мухаммадризо',  4,  'Venice'),
      ('+998901234507', 'Facebook', 'Buy: studio, cash',                    'matching',          'Мухаммадризо',  5,  'Milano'),
      ('+998901234508', 'Телефония','Повторный звонок, уточняет рассрочку', 'meeting_scheduled', 'Мухаммадризо',  5,  'Roma'),
      ('+998901234509', 'Facebook', 'Buy: apartment, срочно',               'meeting_scheduled', 'Мухаммадризо',  6,  'Milano'),
      ('+998901234510', 'Instagram','Хочет посмотреть Milano лично',        'meeting_held',      'Мухаммадризо',  8,  'Milano'),
      ('+998901234511', 'Facebook', 'Buy: 2-комнатная, near metro',         'meeting_held',      'Мухаммадризо',  9,  'Florencia'),
      ('+998901234512', 'Телефония','Приходил на встречу, думает',          'meeting_held',      'Мухаммадризо', 11,  'Milano'),
      ('+998901234513', 'Facebook', 'Buy: studio, готов к брони',           'reserved',          'Мухаммадризо', 13,  'Milano'),
      ('+998901234514', 'Instagram','Забронировал юнит в Roma',             'reserved',          'Мухаммадризо', 15,  'Roma'),
      ('+998901234515', 'Facebook', 'Buy: apartment, оплатил бронь',        'paid_reservation',  'Мухаммадризо', 20,  'Milano')
  ) as l(phone, source, buy_intent, stage, assigned_manager, days_ago, building_name)
  join public.buildings bl on bl.tenant_id = t.id and bl.name = l.building_name
  where t.name = 'Ulkan Development'
) as b
where not exists (
  select 1 from public.leads existing where existing.phone = b.phone and existing.tenant_id = b.id
);
