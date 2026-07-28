# Telegram Business integration in Мастерская — design

## Problem

Мастерская currently shows a fake, scripted Telegram preview (`TelegramPreviewModal.tsx`) — no real messages, no real bot. The client wants a real integration: the pilot manager's actual client conversations happen over Telegram (on the manager's personal account, not a public bot), and reps should be able to see and work those conversations from inside Argus, with the AI already evaluating each incoming message before a human acts.

This is one of two independent "make Argus feel less like a generic CRM" work streams from the 2026-07-28 audit follow-up conversation; the other (navigation/section redesign) is a separate spec.

## Scope

- One pilot manager's personal Telegram account, connected via **Telegram Business** (Bot API's business-connection feature — a bot gains permission to read/send on behalf of a real person's Telegram account, not a company-branded bot the client has to know about or message deliberately).
- Multi-agent support is **not** in scope now — the schema allows for it (see Data model), but only one connection is wired up.
- Client-facing send/receive lives entirely inside `ClientWorkspace.tsx` (Мастерская), alongside the existing AI-assistant chat, not replacing it.

## Product decisions (from brainstorm)

1. **Reply model**: the bot always drafts a suggested reply; nothing is ever sent to the client without the manager explicitly clicking Send (matching Argus's existing "review-after" culture — справка approval works the same way). The manager can also discard the draft and type their own message from scratch.
2. **What "the bot evaluates the client" means**: a short conversation summary + a next-step suggestion, regenerated on every new inbound message. Explicitly *not* an automatic priority (hot/warm/cold) change — that stays a manual field, untouched by this feature.
3. **Discovery of new messages for clients not currently pinned in Мастерская**: a card in Мастерская's main view, the same visual pattern already used for "Ждут решения" (unpinned справки waiting on approval) — clicking it opens/pins that client.
4. **Client matching**: automatic by phone number when Telegram's business connection provides it; if not available (or if the phone matches more than one Argus client), the conversation shows as unmatched with a manual "attach to client" banner — reusing the existing client-search UI already in Мастерская's "add a client" flow.
5. **Layout**: two columns, both visible at once, no tab-switching — left is the live Telegram thread + draft reply, right is the existing AI-assistant column (now also showing summary/next-step at the top, справки below unchanged).
6. **Timing**: summary/next-step/draft are generated synchronously in the webhook handler, the moment a message arrives — not lazily when a manager opens the card. Matches Cortège's `generate_reply()` pattern (call the model inline, before anyone's looking).

## Architecture

**Technical approach: plain `httpx` calls to the Bot API, no framework.** Argus's existing AI integration (`app/ai/functions.py`) is already lean/dependency-light; a single business connection doesn't need aiogram's command-dispatcher machinery (that's built for multi-command polling bots, not "receive a business message, call GPT, maybe send a reply"). Cortège uses aiogram, but that's solving a different problem (a public bot with many chat commands) — copying it here would be a needless dependency and a second bot-framework convention in the codebase.

**New backend router**: `app/routers/telegram_business.py`

- `POST /webhook/telegram-business` — validates `X-Telegram-Bot-Api-Secret-Token` via `hmac.compare_digest` (same pattern already proven in Cortège), parses the JSON body directly (no aiogram `Update` model).
  - `business_message` / `edited_business_message` → the real work: persist the message, resolve/match the client, call GPT-4o for `{summary, next_step, draft_reply}`, persist all three onto the conversation row.
  - `business_connection` → persist connect/disconnect state (`telegram_business_connections.is_enabled`).
- `POST /api/telegram-business/{conversation_id}/send` — sends the (possibly edited) approved reply via `sendMessage` with the connection's `business_connection_id`, persists it as an outbound message.
- `PATCH /api/telegram-business/conversations/{id}/link` — attach an unmatched conversation to an existing client (body: `client_id`), or create a new one inline by reusing `get_or_create_client` (`app/services/client_service.py`) — the same helper `spravka_service.py` already calls for phone/name-based client creation.

**GPT-4o call**: same function-calling/structured-output convention already used elsewhere in `app/ai/`; input is the conversation's recent message history, output is strict JSON (`summary`, `next_step`, `draft_reply`) — no free-form parsing.

**Nothing about the existing AI-assistant `conversations`/`messages` tables changes** — this is a fully separate data domain (rep-facing assistant chat vs. client-facing Telegram thread).

## Data model

Three new tables, tenant-scoped like everything else in Argus (service-role client + explicit `tenant_id` filtering, matching the existing convention — no new RLS policies needed since Argus doesn't rely on RLS today).

```sql
telegram_business_connections
  id, tenant_id, manager_email, business_connection_id, telegram_user_id,
  is_enabled, connected_at, disconnected_at

telegram_conversations
  id, tenant_id, business_connection_id, client_id (nullable),
  telegram_chat_id, telegram_first_name, telegram_username,
  last_message_at, created_at,
  -- current-state AI evaluation, overwritten each new inbound message
  -- (same idea as spravka_requests.computed_summary -- a snapshot, not history)
  summary, next_step_suggestion, draft_reply, draft_generated_at
  -- unique (business_connection_id, telegram_chat_id)

telegram_messages
  id, conversation_id, direction ('inbound'|'outbound'), content,
  telegram_message_id, sent_by (manager email, null for inbound), created_at
```

`telegram_business_connections` is a table (not a single row hardcoded) specifically so a second agent's connection is additive later — no schema change needed to go multi-agent, just more rows and a way to pick which connection a given `ClientWorkspace` client belongs to.

## UI (`ClientWorkspace.tsx`)

New component `TelegramBusinessThread`, rendered alongside (not replacing) the existing AI-assistant section:

- **Left column** — live message feed (client messages left-aligned, manager's right-aligned, same `glass-panel` visual language as the rest of Argus). Below the feed: the current draft reply in a visually distinct "suggestion" block — editable textarea, **Отправить** and **Написать своё** (blank the draft, type from scratch) buttons. If unmatched: a banner at the top — "Кто это? [Выбрать клиента ▾] [Создать нового]".
- **Right column** — unchanged AI-assistant column, with a new block at the top: "Итог диалога" (summary) + next-step suggestion, both regenerated live. Справки list/creation button below, exactly as today.

`TelegramPreviewModal.tsx` (the scripted fake demo) gets removed once this ships — it was always a placeholder for this.

## Edge cases

- **Duplicate phone across clients**: never auto-match ambiguously — falls back to the manual "attach to client" banner rather than guessing wrong.
- **Business connection disconnected** (Telegram sends `business_connection` with `is_enabled: false`): persisted immediately; Мастерская's Обзор view shows a warning ("Telegram отключён — переподключите") until reconnected.
- **AI call fails/times out**: the message still saves and shows in the thread even if summary/next-step/draft generation fails — a manager can always fall back to "Написать своё" and reply manually. The feature degrades to "just relay messages," never blocks on the AI.

## Out of scope (this pass)

- Multi-agent Telegram connections (schema supports it, UI/onboarding doesn't yet).
- Any self-serve "connect your Telegram" flow — the one pilot connection is set up manually/operationally, the same way Cortège's single bot token is today.
- Instagram or any other channel.
- Automatic priority (hot/warm/cold) changes driven by the AI evaluation.
