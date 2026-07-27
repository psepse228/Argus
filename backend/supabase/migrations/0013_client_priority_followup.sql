-- Приоритет (hot/warm/cold) и ручной "следующий контакт" -- the real stand-in
-- for a call log until Argus has an actual telephony/Telegram integration:
-- the manager logs it themselves after a call, same as any CRM without a
-- dialer. Both live on clients (the durable identity); priority also lives
-- on leads since that's what the Лиды board itself renders.

alter table public.clients add column priority text check (priority in ('hot', 'warm', 'cold'));
alter table public.clients add column next_followup_at date;
alter table public.clients add column next_followup_note text;

alter table public.leads add column priority text check (priority in ('hot', 'warm', 'cold'));

create index on public.clients (tenant_id, next_followup_at);
