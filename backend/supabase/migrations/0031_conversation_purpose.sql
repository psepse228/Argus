-- Argus Brain Phase 4: the help chatbot needs its own conversation thread
-- per user, kept out of the general Ассистент inbox's conversation list
-- (which currently shows every client_id-null conversation as a switchable
-- thread). 'chat' is every conversation that exists today (general
-- assistant threads and client profile-chats alike); 'help' is new.
alter table public.conversations
  add column purpose text not null default 'chat' check (purpose in ('chat', 'help'));
