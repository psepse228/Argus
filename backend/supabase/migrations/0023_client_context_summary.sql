-- Manager-handover problem: when a sales agent leaves, whoever takes over
-- their clients has zero context -- just raw leads/spravki/messages to dig
-- through. This is a rolling AI-generated "what to know before you talk to
-- this person" brief, regenerated on demand (a button, not automatic on
-- every event) so any manager -- new or old -- can read 2-3 sentences
-- instead of reconstructing history from scratch.
alter table public.clients add column ai_context_summary text;
alter table public.clients add column ai_context_generated_at timestamptz;
