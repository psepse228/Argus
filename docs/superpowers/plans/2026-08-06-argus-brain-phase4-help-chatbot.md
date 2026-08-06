# Argus Brain Phase 4 — "Как всё работает" Help Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A staff-only, always-available help chatbot that explains Argus's own features from a static system prompt — no function-calling, no business data — reachable from a new topbar icon, isolated from the real client/assistant conversation history.

**Architecture:** A new `purpose` column on `conversations` (`'chat'` default, or `'help'`) keeps this feature's single running thread per user out of the general Ассистент inbox's conversation list. `backend/app/ai/help_chat.py` is a new, deliberately small, isolated module — a single GPT-4o call over a static `HELP_SYSTEM_PROMPT`, no `tools` param at all (not `run_chat` with empty schemas — OpenAI's API rejects an empty `tools` array, so this is a genuinely separate code path, matching the design spec's "small, isolated" call). `POST /api/assistant/help/chat` (added to the existing `assistant.py` router) persists messages through the same `conversations`/`messages` tables as the other two assistants. On the frontend, `ChatThread.tsx` gains a `mode` prop so it can dispatch to the new endpoint instead of boss/agent chat, and a new `HelpChatWidget.tsx` (same floating-panel shape as `AssistantWidget.tsx`, but opened from a new `HudToolbar.tsx` icon instead of its own launcher button) hosts it.

**Tech Stack:** FastAPI + Supabase, OpenAI GPT-4o (plain single-shot chat completion, no `response_format`/no `tools`), Next.js/React/TypeScript.

---

## Task 1: Migration — `conversations.purpose`

**Files:**
- Create: `backend/supabase/migrations/0031_conversation_purpose.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Argus Brain Phase 4: the help chatbot needs its own conversation thread
-- per user, kept out of the general Ассистент inbox's conversation list
-- (which currently shows every client_id-null conversation as a switchable
-- thread). 'chat' is every conversation that exists today (general
-- assistant threads and client profile-chats alike); 'help' is new.
alter table public.conversations
  add column purpose text not null default 'chat' check (purpose in ('chat', 'help'));
```

- [ ] **Step 2: Apply and verify**

Run: `cd backend && npx.cmd supabase db push --linked`
Then: `npx.cmd supabase migration list`
Expected: `0031` appears in both the `local` and `remote` columns (not just `local` — a `remote`-only gap means it didn't actually apply).

- [ ] **Step 3: Commit**

```bash
cd backend
git add supabase/migrations/0031_conversation_purpose.sql
git commit -m "feat: add conversations.purpose for the help chatbot thread

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `help_chat.py` AI module

**Files:**
- Create: `backend/app/ai/help_chat.py`
- Create: `backend/tests/test_help_chat.py`

**Context:** `backend/app/ai/chat.py` already defines `ChatUnavailableError` (raised when the OpenAI call itself fails — quota/rate-limit/outage — as opposed to a function-call failure). Reuse that same exception class here so `assistant.py`'s router can catch it identically to how it already catches it from `run_chat`. Do NOT import or reuse `chat.py`'s private `_get_client`/`_complete` helpers — every `app/ai/*.py` module in this codebase defines its own `_client`/`_get_client()` singleton (see `daily_briefing.py`, `company_summary.py`, `client_segmentation.py`); follow that same convention here, it's deliberate isolation per the design spec ("small, isolated" — this module should have zero coupling to the function-calling loop).

- [ ] **Step 1: Write the module**

```python
"""Static, no-function-calling GPT-4o chat that explains Argus's own
features to logged-in staff -- the "Как всё работает" help chatbot (Phase 4
of Argus Brain). Deliberately isolated from app/ai/chat.py's function-calling
loop (see docs/superpowers/specs/2026-08-05-argus-brain-design.md): this
never touches business data, so it can't leak anything between tenants or
propose an action to confirm -- it only explains the app itself. No
response_format, no tools -- passing an empty tools array to the OpenAI API
is a hard error, so this is a genuinely separate code path from run_chat,
not run_chat called with schemas=[].
"""
import logging
import os

from openai import APIError, OpenAI

from app.ai.chat import ChatUnavailableError

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


HELP_SYSTEM_PROMPT = """Ты объясняешь сотрудникам Ulkan Development, как пользоваться Argus --
их внутренней CRM для проекта Italiano Vero. Ты НЕ видишь реальные данные компании (лидов,
клиентов, юниты, справки) -- только структуру и возможности самого приложения. Если тебя
спрашивают о конкретных цифрах или клиентах, объясни, в каком разделе это искать, но не
выдумывай ответ.

Разделы Argus:
- Юниты -- шахматка всех юнитов по зданиям (Milano, Roma, Neapol, Venice, Florencia), статус
  (в продаже/забронирован/продан), кнопка звонка клиенту.
- Лиды -- воронка от первого контакта до подписанного договора (стадии: холодный, подбор,
  встреча назначена, встреча прошла, резерв, оплаченный резерв, сделка в процессе, договор
  подписан).
- Клиенты / Мастерская -- карточка клиента с историей, справками и AI-советником, который следит
  за живым диалогом в Telegram и подсказывает, что делать дальше.
- Справки -- документ с ценой и условиями оплаты для клиента; создаётся менеджером или через
  AI-ассистента, проходит проверку у руководителя.
- Календарь -- встречи и показы; после прошедшей встречи Argus просит короткую заметку, как она
  прошла.
- Журнал AI -- лог всего, что делал AI: советы, предложенные события, отправленные черновики.
- Ассистент -- раздел "На сегодня" с AI-приоритетным списком задач на день, плюс общий чат с
  AI-ассистентом (может искать юниты, считать сводки, оформлять справки).
- Сводка (только руководитель) -- кнопка "Спросить AI" даёт живую сводку по всей компании: лиды
  по стадиям, юниты в продаже, справки, встречи на сегодня.

Правила:
- Отвечай кратко и по-человечески, на русском.
- Если вопрос не про Argus (например, просят решить бизнес-задачу или дать реальные цифры) --
  вежливо направь в нужный раздел или к руководителю, не пытайся угадать ответ.
- Не выдумывай функции, которых нет в списке выше."""


def run_help_chat(user_message: str, history: list[dict] | None = None) -> str:
    """No function-calling, no business data -- a single GPT-4o call over a
    static system prompt. Raises ChatUnavailableError on an OpenAI-side
    failure, same as app/ai/chat.py's run_chat, so the router can translate
    it into the same clean 503 the other two assistants already use."""
    messages = [{"role": "system", "content": HELP_SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_message})
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages)
    except APIError as e:
        logger.exception("Help chat OpenAI call failed")
        raise ChatUnavailableError(str(e)) from e
    return resp.choices[0].message.content or ""
```

- [ ] **Step 2: Write tests**

```python
import app.ai.help_chat as mod
from app.ai.chat import ChatUnavailableError
from openai import APIError


def test_run_help_chat_returns_reply_text(monkeypatch):
    class FakeMessage:
        content = "Юниты — это раздел с шахматкой всех квартир по зданиям."

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeCompletions:
        def create(self, **kwargs):
            assert kwargs["model"] == "gpt-4o"
            assert "tools" not in kwargs
            assert "response_format" not in kwargs
            assert kwargs["messages"][0] == {"role": "system", "content": mod.HELP_SYSTEM_PROMPT}
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    reply = mod.run_help_chat("Что такое Юниты?")
    assert reply == "Юниты — это раздел с шахматкой всех квартир по зданиям."


def test_run_help_chat_includes_history_before_the_new_message(monkeypatch):
    captured = {}

    class FakeMessage:
        content = "ok"

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeCompletions:
        def create(self, **kwargs):
            captured["messages"] = kwargs["messages"]
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    history = [{"role": "user", "content": "Привет"}, {"role": "assistant", "content": "Привет! Чем помочь?"}]
    mod.run_help_chat("А что такое Лиды?", history=history)
    assert captured["messages"][1:3] == history
    assert captured["messages"][-1] == {"role": "user", "content": "А что такое Лиды?"}


def test_run_help_chat_raises_chat_unavailable_on_api_error(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            raise APIError("boom", request=None, body=None)

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    try:
        mod.run_help_chat("test")
        assert False, "expected ChatUnavailableError"
    except ChatUnavailableError:
        pass
```

Note: `APIError`'s real constructor needs `request`/`body` kwargs in the installed `openai` SDK version — if the test fails on construction, check `from openai import APIError` usage elsewhere in this codebase (`backend/app/ai/chat.py`'s own imports) for the exact signature this SDK version expects, and adjust the test's `APIError(...)` call accordingly. Don't change `help_chat.py` itself to work around a test-construction issue — only the test.

- [ ] **Step 3: Run tests**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_help_chat.py -v`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
cd backend
git add app/ai/help_chat.py tests/test_help_chat.py
git commit -m "feat: add help_chat AI module for the help chatbot

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Backend endpoints — get-or-create help conversation + chat

**Files:**
- Modify: `backend/app/routers/conversations.py`
- Modify: `backend/app/routers/assistant.py`

**Context:** `conversations.py`'s `list_conversations` currently returns every conversation with `client_id is null` for this (tenant, user) — that's meant to be "every general Ассистент thread", but after Task 1 it would also include the new help thread unless filtered. `get_or_create_client_conversation` is the existing precedent for "exactly one thread per (user, X)" — this task adds the same pattern keyed on `purpose='help'` instead of `client_id`.

- [ ] **Step 1: Scope `list_conversations` to `purpose='chat'`**

In `backend/app/routers/conversations.py`, find `list_conversations` (currently):
```python
@router.get("")
def list_conversations(user=Depends(get_current_user)):
    client = get_service_client()
    res = (
        client.table("conversations").select("*")
        .eq("tenant_id", user.tenant_id).eq("user_email", user.email)
        .is_("client_id", "null")
        .order("updated_at", desc=True)
        .execute()
    )
    return res.data
```
Add `.eq("purpose", "chat")` to the query chain (right after `.is_("client_id", "null")`):
```python
@router.get("")
def list_conversations(user=Depends(get_current_user)):
    client = get_service_client()
    res = (
        client.table("conversations").select("*")
        .eq("tenant_id", user.tenant_id).eq("user_email", user.email)
        .is_("client_id", "null").eq("purpose", "chat")
        .order("updated_at", desc=True)
        .execute()
    )
    return res.data
```

- [ ] **Step 2: Add the get-or-create help conversation endpoint**

Add this new endpoint to `backend/app/routers/conversations.py`, right after `get_or_create_client_conversation` (before `touch_conversation`):

```python
@router.post("/help")
def get_or_create_help_conversation(user=Depends(get_current_user)):
    """The help chatbot has exactly one running thread per user -- same
    get-existing-or-create shape as get_or_create_client_conversation above,
    keyed on purpose='help' instead of client_id."""
    client = get_service_client()
    existing = (
        client.table("conversations").select("*")
        .eq("tenant_id", user.tenant_id).eq("user_email", user.email).eq("purpose", "help")
        .execute()
    )
    if existing.data:
        return existing.data[0]
    row = client.table("conversations").insert({
        "tenant_id": user.tenant_id, "user_email": user.email, "purpose": "help",
    }).execute().data[0]
    return row
```

- [ ] **Step 3: Add the help chat endpoint**

In `backend/app/routers/assistant.py`, add the import (alongside the existing `run_chat` import at the top):
```python
from app.ai.help_chat import run_help_chat
```

Add a new request model and endpoint at the end of the file, after `agent_chat`:

```python
class HelpChatRequest(BaseModel):
    message: str
    conversation_id: str


@router.post("/help/chat")
def help_chat(body: HelpChatRequest, user=Depends(get_current_user)):
    client = get_service_client()
    _load_conversation(client, body.conversation_id, user.tenant_id, user.email)  # 404s if not this user's own
    history = _load_history(client, body.conversation_id)
    _persist(client, body.conversation_id, "user", body.message)
    try:
        reply = run_help_chat(body.message, history)
    except ChatUnavailableError:
        raise HTTPException(status_code=503, detail="Ассистент временно недоступен — попробуйте через минуту")
    _persist(client, body.conversation_id, "assistant", reply)
    return {"reply": reply, "events": []}
```

- [ ] **Step 4: Manual smoke check**

Run: `cd backend && ./.venv/Scripts/python.exe -c "from app.main import app; print(sorted(r.path for r in app.routes if 'help' in r.path))"`
Expected: `['/api/assistant/help/chat', '/api/conversations/help']`

- [ ] **Step 5: Run full backend test suite**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q`
Expected: all tests pass (no existing test should reference `list_conversations`'s old query shape in a way that breaks — if one does, that test needs updating to account for the new `purpose='chat'` filter, not the router code reverted).

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/routers/conversations.py app/routers/assistant.py
git commit -m "feat: add help chatbot conversation + chat endpoints

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `ChatThread.tsx` — support a `mode` prop

**Files:**
- Modify: `frontend/src/components/ChatThread.tsx`
- Modify: `frontend/src/lib/api.ts`

**Context:** `ChatThread`'s `send()` currently always calls `isBoss ? api.bossChat : api.agentChat`. This task adds a third path for help-mode without touching the boss/agent behavior at all.

- [ ] **Step 1: Add `helpChat` to `api.ts`**

In `frontend/src/lib/api.ts`, add this entry right after the existing `agentChat` entry:

```typescript
  helpChat: (message: string, conversationId: string) =>
    request("/api/assistant/help/chat", { method: "POST", body: JSON.stringify({ message, conversation_id: conversationId }) }),
  helpConversation: () => request("/api/conversations/help", { method: "POST" }),
```

- [ ] **Step 2: Add the `mode` prop to `ChatThread`**

In `frontend/src/components/ChatThread.tsx`, update the component's prop type and destructuring (currently):
```typescript
export function ChatThread({
  conversationId, isBoss, spravkaMode, onSpravkaCreated, greeting, initialPrompt, onInitialPromptSent,
}: {
  conversationId: string;
  isBoss: boolean;
  spravkaMode: boolean;
  onSpravkaCreated?: () => void;
  greeting: string;
  initialPrompt?: string;
  onInitialPromptSent?: () => void;
}) {
```
to:
```typescript
export function ChatThread({
  conversationId, isBoss, spravkaMode, onSpravkaCreated, greeting, initialPrompt, onInitialPromptSent, mode = "assistant",
}: {
  conversationId: string;
  isBoss: boolean;
  spravkaMode: boolean;
  onSpravkaCreated?: () => void;
  greeting: string;
  initialPrompt?: string;
  onInitialPromptSent?: () => void;
  /** "help" routes through the isolated, no-function-calling help chatbot
   * endpoint instead of the boss/agent assistant -- see help_chat.py.
   * Defaults to "assistant" so every existing call site is unaffected. */
  mode?: "assistant" | "help";
}) {
```

- [ ] **Step 3: Branch in `send()`**

Find the existing `send()` function body:
```typescript
  async function send(text?: string) {
    const v = (text ?? input).trim();
    if (!v) return;
    setInput("");
    setMessages((cur) => [...cur, { role: "user", text: v }]);
    setTyping(true);
    try {
      const call = isBoss ? api.bossChat : api.agentChat;
      const { reply, events } = await call(v, conversationId, spravkaMode ? "spravka" : undefined);
      const allEvents: ChatEvent[] = events || [];
      setMessages((cur) => [...cur, { role: "bot", text: reply, events: allEvents.length ? allEvents : undefined }]);
      if (allEvents.some(isSpravkaCreated)) onSpravkaCreated?.();
    } catch (e: any) {
      setMessages((cur) => [...cur, { role: "bot", text: `Ошибка: ${e.message}` }]);
    } finally {
      setTyping(false);
    }
  }
```
Change the `try` block's first two lines to:
```typescript
    try {
      const { reply, events } = mode === "help"
        ? await api.helpChat(v, conversationId)
        : await (isBoss ? api.bossChat : api.agentChat)(v, conversationId, spravkaMode ? "spravka" : undefined);
      const allEvents: ChatEvent[] = events || [];
```
(the rest of the function body is unchanged)

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/components/ChatThread.tsx src/lib/api.ts
git commit -m "feat: add help-chat mode to ChatThread and api.helpChat

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `HelpChatWidget.tsx` + topbar icon

**Files:**
- Create: `frontend/src/components/HelpChatWidget.tsx`
- Modify: `frontend/src/components/HudToolbar.tsx`
- Modify: `frontend/src/app/app/page.tsx`

**Context:** Read `frontend/src/components/AssistantWidget.tsx` in full first — `HelpChatWidget` reuses its floating `glass-panel` + `ChatThread` shape, but with two differences: (1) its `open`/close state is controlled from outside via props (mirroring how `GlobalSearch`'s `open`/`onOpenChange` is lifted to `page.tsx` and triggered from `HudToolbar`'s `onOpenSearch`, NOT self-toggled like `AssistantWidget`'s own floating launcher button), because the launcher for this one is a topbar icon, not a new floating circle; (2) it fetches/creates its conversation via `api.helpConversation()` instead of `api.conversations()`/`api.createConversation()`, and passes `mode="help"` to `ChatThread`. Position it in the opposite corner from `AssistantWidget` (which sits bottom-right) so the two floating panels never fight for the same screen space — top-right, below `HudToolbar` (which sits at `top: 16, right: 16`).

- [ ] **Step 1: Create `HelpChatWidget.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { api, CurrentUser } from "@/lib/api";
import { ChatThread } from "./ChatThread";

/** "Как всё работает" -- Argus Brain Phase 4's staff-only help chatbot.
 * Opened from a topbar icon (HudToolbar.tsx), not a self-owned launcher
 * button like AssistantWidget -- so open/close state lives in the parent
 * (page.tsx), matching how GlobalSearch is already wired. Sits top-right,
 * below the toolbar, so it never overlaps AssistantWidget's bottom-right
 * floating launcher. Talks to the isolated help_chat.py endpoint (no
 * function-calling, no business data) via ChatThread's mode="help". */
export function HelpChatWidget({
  open, onClose, user,
}: {
  open: boolean;
  onClose: () => void;
  user: CurrentUser;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || conversationId) return;
    api.helpConversation().then((conv) => setConversationId(conv.id)).catch(() => {});
  }, [open, conversationId]);

  if (!open) return null;

  return (
    <div
      className="glass-panel section-enter"
      style={{
        position: "fixed", top: 64, right: 16, width: 360, height: 480, zIndex: 500,
        display: "flex", flexDirection: "column", padding: "16px 18px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--v-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2.2}>
              <circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 1.8-2 3.3" /><path d="M12 17h.01" />
            </svg>
          </span>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 13.5, fontWeight: 800, color: "var(--color-text)" }}>Как всё работает</span>
        </div>
        <div onClick={onClose} role="button" aria-label="Закрыть помощь" style={{ cursor: "pointer", color: "var(--color-text-faint)", padding: 4 }}>
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M6 6l12 12M18 6 6 18" /></svg>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {conversationId ? (
          <ChatThread
            conversationId={conversationId}
            isBoss={user.role === "boss"}
            spravkaMode={false}
            greeting="Спросите, как пользоваться любым разделом Argus — Юниты, Лиды, Справки, Календарь и так далее."
            mode="help"
          />
        ) : (
          <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка…</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the topbar icon**

In `frontend/src/components/HudToolbar.tsx`, add `onOpenHelp?: () => void` to the component's prop type (right after `onOpenSearch`):
```typescript
export function HudToolbar({
  user, previewRole, onPreviewRoleChange, onOpenSearch, onOpenHelp, presentationMode, onTogglePresentation,
}: {
  user: CurrentUser;
  previewRole?: "boss" | "sales_agent";
  onPreviewRoleChange?: (r: "boss" | "sales_agent") => void;
  onOpenSearch?: () => void;
  onOpenHelp?: () => void;
  presentationMode?: boolean;
  onTogglePresentation?: () => void;
}) {
```
Then add a new button right after the existing `onOpenSearch` button block (which currently ends right before the `onTogglePresentation` block):
```tsx
      {onOpenHelp && (
        <button
          onClick={onOpenHelp}
          title="Как всё работает"
          aria-label="Как всё работает"
          className="press"
          style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid var(--color-hairline-soft)", background: "var(--surface-03)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="var(--color-text-soft)" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 1.8-2 3.3" /><path d="M12 17h.01" />
          </svg>
        </button>
      )}
```

- [ ] **Step 3: Wire it up in `page.tsx`**

In `frontend/src/app/app/page.tsx`, add the import:
```typescript
import { HelpChatWidget } from "@/components/HelpChatWidget";
```
Add state near the existing `searchOpen` state (search for `const [searchOpen, setSearchOpen]` or equivalent — add right after it):
```typescript
  const [helpOpen, setHelpOpen] = useState(false);
```
Pass the new prop to `HudToolbar` (find the existing `<HudToolbar ... onOpenSearch={() => setSearchOpen(true)} ... />` call):
```tsx
      <HudToolbar
        user={effectiveUser}
        previewRole={canPreviewRole ? (previewRole || "boss") : undefined}
        onPreviewRoleChange={canPreviewRole ? changePreviewRole : undefined}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        presentationMode={presentationMode}
        onTogglePresentation={() => setPresentationMode((v) => !v)}
      />
```
Render the widget near `<GlobalSearch ... />` (right after it):
```tsx
      <HelpChatWidget open={helpOpen} onClose={() => setHelpOpen(false)} user={effectiveUser} />
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/components/HelpChatWidget.tsx src/components/HudToolbar.tsx src/app/app/page.tsx
git commit -m "feat: add 'Как всё работает' help chatbot topbar icon + panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Manual verification + push

**Files:** none (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q`
Expected: all tests pass (44 existing + 3 new from Task 2 = 47).

- [ ] **Step 2: Run frontend production build**

Run: `cd frontend && npm run build`
Expected: `✓ Compiled successfully`, no type errors.

- [ ] **Step 3: Confirm migration applied on remote**

Run: `cd backend && npx.cmd supabase migration list`
Expected: `0031` present in both `local` and `remote` columns.

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Confirm Railway deploy**

Check both services (frontend + backend) deploy the pushed commit SHA with `SUCCESS` status.
