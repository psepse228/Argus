-- Throttles the expensive GPT candidate-generation pass inside
-- sync_brain_items -- previously every call to GET /api/brain-items (no
-- polling on the frontend, but nothing stopped a second tab, a fast
-- double-navigation, or a future caller from hitting it repeatedly) fired
-- a fresh gpt-4o call. Cheap deterministic candidates (unconfirmed events,
-- promoted ai_events) still run every time; only the GPT pass is gated on
-- this timestamp, since that's the only part with real per-call cost.
alter table public.tenant_users
  add column brain_synced_at timestamptz;
