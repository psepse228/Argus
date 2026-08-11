-- Real bug found live (2026-08-10): get_or_create_client_conversation and
-- get_or_create_help_conversation are both a plain "SELECT for an existing
-- row, INSERT if none found" with no DB-level guard -- two near-simultaneous
-- requests (e.g. two components mounting at once, a fast re-render, two
-- tabs) can both see "none found" and both INSERT, creating two competing
-- conversation threads for the same (rep, client) pair. Found two literal
-- duplicates in production, ~114ms apart, for the same manager+client --
-- which conversation the frontend loads on a given visit was effectively a
-- coin flip, showing a different, incomplete history each time ("assistant
-- works crooked").
--
-- Partial unique indexes (not a plain multi-column unique constraint,
-- since a NULL client_id is a general chat, of which a rep can have many)
-- turn the race into a clean, catchable conflict instead of a silent
-- duplicate -- see conversations.py's insert-then-fallback-to-select.
create unique index conversations_one_per_rep_client
  on public.conversations (tenant_id, user_email, client_id)
  where client_id is not null;

create unique index conversations_one_help_per_rep
  on public.conversations (tenant_id, user_email)
  where purpose = 'help';
