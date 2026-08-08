-- Proactive Argus Brain (2026-08-08): the existing Telegram bot
-- (@Argus_solurabot, TELEGRAM_BOT_TOKEN) already relays client messages via
-- Telegram Business connections (see telegram_business_connections). This
-- adds a second, unrelated capability on the SAME bot: talking directly to
-- a manager/boss in their own normal chat with the bot -- no business
-- connection involved, just a plain sendMessage to whatever chat_id they
-- get after they /start the bot themselves.
--
-- telegram_link_code is a short-lived, one-time code shown in Argus
-- ("Подключить Telegram" button) and sent back as `/start <code>` --
-- resolved by the webhook to set telegram_chat_id, then cleared.
alter table public.tenant_users
  add column telegram_chat_id bigint,
  add column telegram_link_code text;

create unique index tenant_users_telegram_link_code_idx
  on public.tenant_users (telegram_link_code)
  where telegram_link_code is not null;
