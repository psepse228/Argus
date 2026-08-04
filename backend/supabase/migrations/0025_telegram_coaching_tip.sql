-- Мастерская advisor (Argus Brain Phase 1): telegram_evaluator now returns a
-- proactive coaching_tip alongside summary/next_step/draft_reply -- same
-- storage pattern as those three (overwritten each new inbound message, a
-- snapshot not a history, see 0019_telegram_business.sql).
alter table public.telegram_conversations add column coaching_tip text;
