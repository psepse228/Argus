# Telegram Business Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Telegram Business connection for one pilot manager's personal account, surfaced live inside Мастерская's `ClientWorkspace.tsx` — the bot drafts replies for human approval, evaluates each incoming message (summary + next-step), and matches conversations to Argus clients automatically by phone (via shared contact) with a manual fallback.

**Architecture:** New FastAPI router (`app/routers/telegram_business.py`) using plain `httpx` against the Telegram Bot API (no aiogram) receives `business_message` webhook updates, persists them, calls GPT-4o for structured evaluation, and exposes send/link endpoints. Three new Supabase tables. Frontend gets a new `TelegramBusinessThread` component (left-column live chat + draft reply) and `TelegramSummaryCard` (right-column summary/next-step), wired into `ClientWorkspace.tsx` in place of the current `TelegramPreviewModal` fake preview, plus an "unmatched conversations" list in `WorkshopPanel.tsx`.

**Tech Stack:** FastAPI, httpx, Supabase (Postgres), OpenAI (`gpt-4o` with Structured Outputs), Next.js/React/TypeScript. Testing: this codebase has no pytest setup today (verified — no `pytest.ini`/`conftest.py`/pytest in `requirements.txt`) and the established convention this whole project has used is manual verification against the real dev Supabase project via `curl`, not automated tests. This plan adds a minimal `pytest` setup for the handful of pure-logic pieces that don't need live services (phone/contact parsing, webhook signature check, JSON evaluation parsing), and uses manual `curl`-against-dev-server verification for everything that inherently needs live Supabase/Telegram/OpenAI — consistent with how every other feature in this codebase has actually been verified so far.

**Spec correction carried into this plan:** the spec's "phone matches more than one client" edge case cannot happen — `clients` has a `unique (tenant_id, phone)` constraint (see `supabase/migrations/0010_clients_conversations.sql:17`). Matching is a single unambiguous lookup, not a disambiguation UI.

**Telegram API detail governing the matching design:** Bot API `User`/`Chat` objects never include a phone number, business connection or not — a phone only ever appears when the client sends a `contact` message (tapped "share contact"). So "match by phone" triggers specifically when `message.contact.phone_number` is present in a `business_message` update, not on every text message.

---

## File structure

**Backend — new files:**
- `backend/supabase/migrations/0019_telegram_business.sql` — 3 tables.
- `backend/app/telegram/__init__.py` — empty, makes it a package.
- `backend/app/telegram/bot_client.py` — `verify_webhook_signature()`, `send_message()`, `set_webhook()` thin httpx wrappers. One responsibility: talk to the Bot API's HTTP surface, nothing else.
- `backend/app/telegram/matching.py` — `find_client_by_phone()` (Supabase lookup) — kept separate from `bot_client.py` since it's Supabase logic, not Telegram HTTP logic.
- `backend/app/ai/telegram_evaluator.py` — `evaluate_conversation()`, one GPT-4o structured-output call.
- `backend/app/routers/telegram_business.py` — the three HTTP endpoints (webhook, send, link) plus an unmatched-conversations list endpoint.
- `backend/tests/__init__.py`, `backend/tests/test_bot_client.py`, `backend/tests/test_telegram_evaluator.py` — the pure-logic unit tests.

**Backend — modified files:**
- `backend/app/main.py` — register the new router.
- `backend/requirements.txt` — add `pytest`.

**Frontend — new files:**
- `frontend/src/components/TelegramBusinessThread.tsx` — left-column live chat + draft-reply editor.
- `frontend/src/components/TelegramSummaryCard.tsx` — right-column summary/next-step block.

**Frontend — modified files:**
- `frontend/src/lib/types.ts` — `TelegramConversation`, `TelegramMessage` types.
- `frontend/src/lib/api.ts` — new `api.telegramBusiness*` methods.
- `frontend/src/components/ClientWorkspace.tsx` — replace the Cortège+ teaser block (lines 391–413) with `<TelegramBusinessThread>`; add `<TelegramSummaryCard>` above `<ChatThread>` in the right column (around line 416–431); remove the `TelegramPreviewModal` import/usage.
- `frontend/src/components/WorkshopPanel.tsx` — new "Непривязанные Telegram-чаты" section, same visual slot/pattern as the existing `unpinnedApprovals` block.

**Frontend — deleted files:**
- `frontend/src/components/TelegramPreviewModal.tsx` — fully replaced by the real thing.

---

## Task 1: Database migration

**Files:**
- Create: `backend/supabase/migrations/0019_telegram_business.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Real Telegram Business integration for Мастерская (see
-- docs/superpowers/specs/2026-07-28-telegram-business-integration-design.md).
-- Replaces the scripted TelegramPreviewModal fake demo with a real,
-- one-manager-for-now Telegram Business connection.

create table public.telegram_business_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  manager_email text not null,
  business_connection_id text not null,
  telegram_user_id bigint not null,
  is_enabled boolean not null default true,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  unique (tenant_id, business_connection_id)
);

create table public.telegram_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Named connection_id, not business_connection_id, so it can't be
  -- confused with telegram_business_connections.business_connection_id
  -- (that one's the raw Telegram-issued string; this is our own uuid FK).
  connection_id uuid not null references public.telegram_business_connections(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  telegram_chat_id bigint not null,
  telegram_first_name text,
  telegram_username text,
  summary text,
  next_step_suggestion text,
  draft_reply text,
  draft_generated_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (connection_id, telegram_chat_id)
);
create index on public.telegram_conversations (tenant_id, client_id);
-- Supports the Мастерская discovery card's "most recent activity" ordering
-- (see Task 9) -- without this, that query has nothing but a full scan.
create index on public.telegram_conversations (tenant_id, last_message_at desc);

create table public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.telegram_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  content text not null,
  telegram_message_id bigint,
  sent_by text,
  created_at timestamptz not null default now()
);
create index on public.telegram_messages (conversation_id, created_at);
```

- [ ] **Step 2: Tell the user to apply it manually**

This project's convention (established all session) is manual application via the Supabase SQL editor — never an automated runner. After writing this file, tell the user: "New migration `0019_telegram_business.sql` needs to be run in the Supabase SQL editor before Task 3 (webhook handler) can be tested against real data."

- [ ] **Step 3: Commit**

```bash
cd "backend"
git add supabase/migrations/0019_telegram_business.sql
git commit -m "feat(db): add telegram_business_connections/conversations/messages tables"
```

---

## Task 2: pytest bootstrap + Bot API HTTP client

This codebase has zero test infrastructure today. This task adds the minimum needed to unit-test pure logic, without pretending the rest of the app suddenly has full test coverage.

**Files:**
- Create: `backend/pytest.ini`
- Create: `backend/tests/__init__.py`
- Create: `backend/app/telegram/__init__.py`
- Create: `backend/app/telegram/bot_client.py`
- Test: `backend/tests/test_bot_client.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add pytest to requirements and install it**

Append to `backend/requirements.txt`:
```
pytest
```

Run: `cd backend && .venv/Scripts/python.exe -m pip install pytest`
Expected: `Successfully installed pytest-...`

- [ ] **Step 2: Add pytest config so `app` is importable**

Create `backend/pytest.ini`:
```ini
[pytest]
pythonpath = .
```

- [ ] **Step 3: Create the package + empty test package**

Create `backend/app/telegram/__init__.py` (empty file).
Create `backend/tests/__init__.py` (empty file).

- [ ] **Step 4: Write the failing tests for webhook signature verification**

Create `backend/tests/test_bot_client.py`:

```python
def test_verify_webhook_signature_correct(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t")
    from app.telegram.bot_client import verify_webhook_signature
    assert verify_webhook_signature("s3cr3t") is True


def test_verify_webhook_signature_wrong(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t")
    from app.telegram.bot_client import verify_webhook_signature
    assert verify_webhook_signature("wrong") is False


def test_verify_webhook_signature_missing_header(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t")
    from app.telegram.bot_client import verify_webhook_signature
    assert verify_webhook_signature(None) is False


def test_verify_webhook_signature_no_secret_configured(monkeypatch):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_SECRET", raising=False)
    from app.telegram.bot_client import verify_webhook_signature
    assert verify_webhook_signature("anything") is False


def test_send_message_calls_correct_endpoint(monkeypatch):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"ok": True}

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["json"] = json
        return FakeResponse()

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:ABC")
    import app.telegram.bot_client as bot_client
    monkeypatch.setattr(bot_client.httpx, "post", fake_post)

    result = bot_client.send_message("conn123", 999, "Hello")

    assert captured["url"] == "https://api.telegram.org/bot123:ABC/sendMessage"
    assert captured["json"] == {"business_connection_id": "conn123", "chat_id": 999, "text": "Hello"}
    assert result == {"ok": True}
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_bot_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.telegram.bot_client'`

- [ ] **Step 6: Write the implementation**

Create `backend/app/telegram/bot_client.py`:

```python
"""Thin HTTP client for the Telegram Bot API's business-connection surface --
one responsibility: talk to Telegram over HTTP, nothing about Supabase or
GPT lives here. Plain httpx, not aiogram -- a single business connection
doesn't need a multi-command dispatcher framework (see the design spec for
why Cortège's aiogram setup isn't a fit here).
"""
import hmac
import os

import httpx

TELEGRAM_API_BASE = "https://api.telegram.org"


def verify_webhook_signature(received_secret: str | None) -> bool:
    """Telegram echoes back whatever secret was configured via set_webhook
    as the X-Telegram-Bot-Api-Secret-Token header on every request --
    constant-time compare (hmac.compare_digest, not `==`) against a timing
    attack, same pattern already proven in Cortège's webhook."""
    expected = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
    return bool(expected) and hmac.compare_digest(received_secret or "", expected)


def send_message(business_connection_id: str, chat_id: int, text: str) -> dict:
    """Sends as the connected business account, not as the bot itself --
    business_connection_id is what makes the client see this land in their
    chat with the manager's real Telegram account, not some generic bot."""
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    resp = httpx.post(
        f"{TELEGRAM_API_BASE}/bot{token}/sendMessage",
        json={"business_connection_id": business_connection_id, "chat_id": chat_id, "text": text},
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_bot_client.py -v`
Expected: `4 passed`

- [ ] **Step 8: Commit**

```bash
cd backend
git add pytest.ini tests/__init__.py app/telegram/__init__.py app/telegram/bot_client.py tests/test_bot_client.py requirements.txt
git commit -m "feat(telegram): add Bot API httpx client + pytest bootstrap"
```

---

## Task 3: client matching by phone

**Files:**
- Create: `backend/app/telegram/matching.py`
- Test: `backend/tests/test_matching.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_matching.py`:

```python
from app.telegram.matching import find_client_by_phone, normalize_phone


def test_normalize_phone_adds_leading_plus():
    assert normalize_phone("998911110009") == "+998911110009"


def test_normalize_phone_leaves_existing_plus():
    assert normalize_phone("+998911110009") == "+998911110009"


def test_normalize_phone_strips_whitespace():
    assert normalize_phone("  998911110009  ") == "+998911110009"


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, data):
        self._data = data

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def execute(self):
        return _FakeResult(self._data)


class _FakeClient:
    def __init__(self, data):
        self._data = data

    def table(self, name):
        return _FakeQuery(self._data)


def test_find_client_by_phone_found():
    fake = _FakeClient([{"id": "client-1"}])
    assert find_client_by_phone(fake, "tenant-1", "998911110009") == "client-1"


def test_find_client_by_phone_not_found():
    fake = _FakeClient([])
    assert find_client_by_phone(fake, "tenant-1", "998900000000") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_matching.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.telegram.matching'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/telegram/matching.py`:

```python
"""Resolves an incoming Telegram business message to an Argus client by
phone number. Telegram never exposes a phone number on a User/Chat object by
itself (business connection or not) -- only when the client explicitly
shares their contact card, which is the one moment this ever has a phone
number to work with at all.
"""


def normalize_phone(raw: str) -> str:
    """Telegram's shared-contact phone_number sometimes omits the leading
    '+' (just raw digits), but Argus always stores phones as '+998...' --
    this is the one place the two formats have to agree, or auto-matching
    silently finds nothing and every conversation looks unmatched."""
    digits = raw.strip()
    return digits if digits.startswith("+") else f"+{digits}"


def find_client_by_phone(client, tenant_id: str, phone: str) -> str | None:
    """Look-only, unlike get_or_create_client (app/services/client_service.py)
    -- an unmatched Telegram conversation should show the manual-link
    banner, not silently create a phantom client from a phone number nobody
    at Argus has confirmed belongs to them."""
    normalized = normalize_phone(phone)
    res = client.table("clients").select("id").eq("tenant_id", tenant_id).eq("phone", normalized).execute().data
    return res[0]["id"] if res else None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_matching.py -v`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/telegram/matching.py tests/test_matching.py
git commit -m "feat(telegram): add phone-based client matching"
```

---

## Task 4: AI evaluation (summary + next-step + draft reply)

**Files:**
- Create: `backend/app/ai/telegram_evaluator.py`
- Test: `backend/tests/test_telegram_evaluator.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_telegram_evaluator.py`:

```python
def test_evaluate_conversation_parses_response_and_maps_roles(monkeypatch):
    class FakeMessage:
        content = '{"summary": "s", "next_step": "n", "draft_reply": "d"}'

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    import app.ai.telegram_evaluator as mod
    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())

    result = mod.evaluate_conversation([
        {"role": "client", "content": "Здравствуйте, интересует юнит в Milano"},
        {"role": "manager", "content": "Добрый день! Уточните бюджет?"},
    ])

    assert result == {"summary": "s", "next_step": "n", "draft_reply": "d"}
    assert captured["model"] == "gpt-4o"
    assert captured["messages"][1] == {"role": "user", "content": "Здравствуйте, интересует юнит в Milano"}
    assert captured["messages"][2] == {"role": "assistant", "content": "Добрый день! Уточните бюджет?"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_telegram_evaluator.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.ai.telegram_evaluator'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/ai/telegram_evaluator.py`:

```python
"""GPT-4o structured-output call that turns a Telegram thread into what a
manager needs to act on it: a summary, a next-step suggestion, and a draft
reply. One call, not the multi-turn function-calling loop in app/ai/chat.py
-- that's for the rep-facing assistant chat, this is a single-shot judgment
on a client-facing thread, a different domain entirely.
"""
import json
import os

from openai import OpenAI

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


_SYSTEM_PROMPT = """Ты помогаешь агенту по недвижимости разобрать переписку с клиентом в Telegram.
По всей истории переписки дай: краткое резюме (2-3 предложения — о чём был разговор и что хочет
клиент), подсказку следующего шага (что агенту стоит сделать дальше), и черновик ответа клиенту на
его последнее сообщение (вежливый, по делу). Никогда не выдумывай цены, юниты или условия — если
клиент спросил о чём-то конкретном, чего нет в истории переписки, в черновике предложи агенту
уточнить это лично, а не придумывай цифры."""

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "telegram_evaluation",
        "schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "next_step": {"type": "string"},
                "draft_reply": {"type": "string"},
            },
            "required": ["summary", "next_step", "draft_reply"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def evaluate_conversation(history: list[dict]) -> dict:
    """history: [{"role": "client"|"manager", "content": str}, ...], oldest
    message first. Returns {"summary": str, "next_step": str, "draft_reply": str}."""
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for turn in history:
        messages.append({
            "role": "user" if turn["role"] == "client" else "assistant",
            "content": turn["content"],
        })
    client = _get_client()
    resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
    return json.loads(resp.choices[0].message.content)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_telegram_evaluator.py -v`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/ai/telegram_evaluator.py tests/test_telegram_evaluator.py
git commit -m "feat(telegram): add GPT-4o conversation evaluator (summary/next-step/draft)"
```

---

## Task 5: the router (webhook, send, link, list) + registration

This is the integration point — no new pure logic here, so no new unit tests (everything it calls was already tested in Tasks 2–4). Verification is manual, via curl against the real dev Supabase project, matching how every other endpoint in this codebase has been verified this whole project.

**Telegram Bot API shape this relies on** (Bot API 7.2+ business connections): an incoming `Update` has `business_message` (a `Message` object) when a message arrives via a connected business account; that `Message` carries its own `business_connection_id` field. `Update.business_connection` fires on connect/disconnect. A shared contact arrives as `message.contact.phone_number`.

**Files:**
- Create: `backend/app/routers/telegram_business.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the router**

Create `backend/app/routers/telegram_business.py`:

```python
"""Real Telegram Business integration for Мастерская -- replaces the
scripted TelegramPreviewModal fake demo. One pilot manager's personal
Telegram account for now (see the design spec); the schema supports more
connections later without changes here.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi import Depends
from pydantic import BaseModel

from app.db import get_service_client
from app.deps import get_current_user
from app.telegram.bot_client import TelegramSendError, send_message, verify_webhook_signature
from app.telegram.matching import find_client_by_phone
from app.ai.telegram_evaluator import evaluate_conversation

router = APIRouter()
api_router = APIRouter(prefix="/api/telegram-business")


def _get_connection(client, business_connection_id: str) -> dict | None:
    res = (
        client.table("telegram_business_connections").select("*")
        .eq("business_connection_id", business_connection_id).execute().data
    )
    return res[0] if res else None


def _get_or_create_conversation(client, connection: dict, chat: dict) -> dict:
    existing = (
        client.table("telegram_conversations").select("*")
        .eq("connection_id", connection["id"]).eq("telegram_chat_id", chat["id"])
        .execute().data
    )
    if existing:
        return existing[0]
    inserted = client.table("telegram_conversations").insert({
        "tenant_id": connection["tenant_id"],
        "connection_id": connection["id"],
        "telegram_chat_id": chat["id"],
        "telegram_first_name": chat.get("first_name"),
        "telegram_username": chat.get("username"),
    }).execute().data[0]
    return inserted


def _history_for_evaluation(client, conversation_id: str) -> list[dict]:
    rows = (
        client.table("telegram_messages").select("direction, content")
        .eq("conversation_id", conversation_id).order("created_at").execute().data
    )
    return [{"role": "client" if r["direction"] == "inbound" else "manager", "content": r["content"]} for r in rows]


@router.post("/webhook/telegram-business")
def telegram_business_webhook(update: dict, request: Request):
    # Plain `def`, not `async def` -- this handler makes several blocking
    # Supabase calls below, so it must stay on FastAPI's threadpool path
    # (see concepts/fastapi-async-blocking-io in the wiki). Taking `update:
    # dict` as a body parameter (instead of manually `await request.json()`)
    # is what makes that possible: FastAPI parses the JSON body for us
    # synchronously, and `request` is only used here for its headers, which
    # don't require awaiting either.
    secret = request.headers.get("x-telegram-bot-api-secret-token")
    if not verify_webhook_signature(secret):
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    client = get_service_client()

    connection_event = update.get("business_connection")
    if connection_event:
        client.table("telegram_business_connections").update({
            "is_enabled": connection_event.get("is_enabled", False),
            "disconnected_at": None if connection_event.get("is_enabled") else datetime.now(timezone.utc).isoformat(),
        }).eq("business_connection_id", connection_event["id"]).execute()
        return {"ok": True}

    message = update.get("business_message") or update.get("edited_business_message")
    if not message or "text" not in message:
        return {"ok": True}  # non-text or unrecognized update -- nothing to relay/evaluate

    connection = _get_connection(client, message["business_connection_id"])
    if not connection:
        return {"ok": True}  # message from a connection we don't have a row for -- ignore, don't crash

    conversation = _get_or_create_conversation(client, connection, message["chat"])

    if conversation.get("client_id") is None and message.get("contact"):
        client_id = find_client_by_phone(client, connection["tenant_id"], message["contact"]["phone_number"])
        if client_id:
            client.table("telegram_conversations").update({"client_id": client_id}).eq("id", conversation["id"]).execute()
            conversation["client_id"] = client_id

    client.table("telegram_messages").insert({
        "conversation_id": conversation["id"], "direction": "inbound",
        "content": message["text"], "telegram_message_id": message["message_id"],
    }).execute()
    client.table("telegram_conversations").update({
        "last_message_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation["id"]).execute()

    try:
        history = _history_for_evaluation(client, conversation["id"])
        evaluation = evaluate_conversation(history)
        client.table("telegram_conversations").update({
            "summary": evaluation["summary"], "next_step_suggestion": evaluation["next_step"],
            "draft_reply": evaluation["draft_reply"], "draft_generated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", conversation["id"]).execute()
    except Exception:
        pass  # best-effort -- the message still saved; a manager can always reply manually

    return {"ok": True}


class SendBody(BaseModel):
    text: str


@api_router.post("/conversations/{conversation_id}/send")
def send_reply(conversation_id: str, body: SendBody, user=Depends(get_current_user)):
    client = get_service_client()
    conv = (
        client.table("telegram_conversations").select("*, telegram_business_connections(business_connection_id)")
        .eq("id", conversation_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation = conv[0]
    business_connection_id = conversation["telegram_business_connections"]["business_connection_id"]

    try:
        send_message(business_connection_id, conversation["telegram_chat_id"], body.text)
    except TelegramSendError:
        raise HTTPException(status_code=503, detail="Не удалось отправить сообщение в Telegram — попробуйте ещё раз")
    client.table("telegram_messages").insert({
        "conversation_id": conversation_id, "direction": "outbound",
        "content": body.text, "sent_by": user.email,
    }).execute()
    client.table("telegram_conversations").update({
        "draft_reply": None, "last_message_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation_id).execute()
    return {"ok": True}


class LinkBody(BaseModel):
    client_id: str | None = None
    new_client_name: str | None = None
    new_client_phone: str | None = None


@api_router.patch("/conversations/{conversation_id}/link")
def link_conversation(conversation_id: str, body: LinkBody, user=Depends(get_current_user)):
    client = get_service_client()
    if body.client_id:
        client_id = body.client_id
    elif body.new_client_phone:
        from app.services.client_service import get_or_create_client
        client_id = get_or_create_client(client, user.tenant_id, body.new_client_phone, body.new_client_name)
    else:
        raise HTTPException(status_code=400, detail="client_id or new_client_phone required")

    updated = (
        client.table("telegram_conversations").update({"client_id": client_id})
        .eq("id", conversation_id).eq("tenant_id", user.tenant_id).execute().data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return updated[0]


@api_router.get("/conversations/unmatched")
def list_unmatched(user=Depends(get_current_user)):
    client = get_service_client()
    return (
        client.table("telegram_conversations").select("*")
        .eq("tenant_id", user.tenant_id).is_("client_id", "null")
        .order("last_message_at", desc=True).execute().data
    )


@api_router.get("/conversations/recent-matched")
def list_recent_matched(user=Depends(get_current_user)):
    """Matched conversations too, not just unmatched ones -- a client who
    already has a client_id but isn't pinned into "В работе" would
    otherwise have no way to surface a new message at all. Same discovery
    idea as unpinnedApprovals for справки, just for Telegram activity."""
    client = get_service_client()
    return (
        client.table("telegram_conversations").select("*, clients(name, phone)")
        .eq("tenant_id", user.tenant_id).not_.is_("client_id", "null")
        .order("last_message_at", desc=True).limit(20).execute().data
    )


@api_router.get("/conversations/by-client/{client_id}")
def get_by_client(client_id: str, user=Depends(get_current_user)):
    client = get_service_client()
    conv = (
        client.table("telegram_conversations").select("*")
        .eq("tenant_id", user.tenant_id).eq("client_id", client_id).execute().data
    )
    if not conv:
        return {"conversation": None, "messages": []}
    conversation = conv[0]
    messages = (
        client.table("telegram_messages").select("*")
        .eq("conversation_id", conversation["id"]).order("created_at").execute().data
    )
    return {"conversation": conversation, "messages": messages}
```

- [ ] **Step 2: Register the router**

In `backend/app/main.py`, modify the import line:

```python
from app.routers import auth_google, units, leads, spravka, assistant, pricing, analytics, clients, conversations, payments, workspace, telegram_business
```

And add after the existing `app.include_router(workspace.router)` line:

```python
app.include_router(telegram_business.router)
app.include_router(telegram_business.api_router)
```

- [ ] **Step 3: Compile-check**

Run: `cd backend && .venv/Scripts/python.exe -m py_compile app/routers/telegram_business.py app/main.py`
Expected: no output, exit code 0

- [ ] **Step 4: Run the full pytest suite to make sure nothing broke**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/ -v`
Expected: `10 passed` (4 from Task 2 + 5 from Task 3 + 1 from Task 4)

- [ ] **Step 5: Manual verification against the real dev server**

Only possible once the Task 1 migration has actually been applied in Supabase, and `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` env vars are set (operator sets these up manually via BotFather + Telegram Business settings on the pilot manager's account — same manual-setup convention as Cortège's single bot token). Once that's done:

Run the dev server, then simulate a webhook call:
```bash
curl -X POST http://localhost:8010/webhook/telegram-business \
  -H "X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET value>" \
  -H "Content-Type: application/json" \
  -d '{"update_id": 1, "business_message": {"message_id": 1, "business_connection_id": "<a real connection id>", "chat": {"id": 111, "first_name": "Test"}, "text": "Здравствуйте"}}'
```
Expected: `{"ok":true}`, and a new row in `telegram_conversations` + `telegram_messages` with `summary`/`next_step_suggestion`/`draft_reply` populated (verify via a quick Supabase query, same pattern used throughout this whole project's manual testing).

- [ ] **Step 6: Commit**

```bash
cd backend
git add app/routers/telegram_business.py app/main.py
git commit -m "feat(telegram): add webhook/send/link/list router for business connection"
```

---

## Task 6: frontend types + API client methods

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the types**

Append to `frontend/src/lib/types.ts`:

```typescript
export type TelegramConversation = {
  id: string;
  tenant_id: string;
  connection_id: string;
  client_id: string | null;
  telegram_chat_id: number;
  telegram_first_name: string | null;
  telegram_username: string | null;
  summary: string | null;
  next_step_suggestion: string | null;
  draft_reply: string | null;
  draft_generated_at: string | null;
  last_message_at: string;
  created_at: string;
};

export type TelegramMessage = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  content: string;
  telegram_message_id: number | null;
  sent_by: string | null;
  created_at: string;
};
```

- [ ] **Step 2: Add the API methods**

In `frontend/src/lib/api.ts`, add the `TelegramConversation`/`TelegramMessage` imports to the existing type import line at the top of the file, and append these methods to the `api` object (right after the existing `workspace`/`pinToWorkspace`/`unpinFromWorkspace` methods):

```typescript
  telegramByClient: (clientId: string): Promise<{ conversation: TelegramConversation | null; messages: TelegramMessage[] }> =>
    request(`/api/telegram-business/conversations/by-client/${clientId}`),
  telegramSendReply: (conversationId: string, text: string) =>
    request(`/api/telegram-business/conversations/${conversationId}/send`, { method: "POST", body: JSON.stringify({ text }) }),
  telegramUnmatched: (): Promise<TelegramConversation[]> =>
    request("/api/telegram-business/conversations/unmatched"),
  telegramRecentMatched: (): Promise<(TelegramConversation & { clients: { name: string | null; phone: string } | null })[]> =>
    request("/api/telegram-business/conversations/recent-matched"),
  telegramLinkConversation: (
    conversationId: string,
    body: { client_id?: string; new_client_name?: string; new_client_phone?: string }
  ): Promise<TelegramConversation> =>
    request(`/api/telegram-business/conversations/${conversationId}/link`, { method: "PATCH", body: JSON.stringify(body) }),
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0, no errors

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/lib/types.ts src/lib/api.ts
git commit -m "feat(telegram): add frontend types + API client methods"
```

---

## Task 7: `TelegramBusinessThread` + `TelegramSummaryCard` components

**Files:**
- Create: `frontend/src/components/TelegramSummaryCard.tsx`
- Create: `frontend/src/components/TelegramBusinessThread.tsx`

- [ ] **Step 1: Write `TelegramSummaryCard.tsx`**

```tsx
"use client";
import { TelegramConversation } from "@/lib/types";

/** The right-column "Итог диалога" block above ClientWorkspace's existing
 * AI-assistant ChatThread -- surfaces the bot's per-message evaluation
 * (summary + next-step) of the live Telegram thread, kept fully separate
 * from the rep-facing assistant chat below it. */
export function TelegramSummaryCard({ conversation }: { conversation: TelegramConversation | null }) {
  if (!conversation || (!conversation.summary && !conversation.next_step_suggestion)) return null;
  return (
    <div className="glass-panel" style={{ padding: "14px 16px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)" }}>
        Итог диалога в Telegram
      </div>
      {conversation.summary && (
        <div style={{ fontSize: 12.5, color: "var(--color-text)", lineHeight: 1.5 }}>{conversation.summary}</div>
      )}
      {conversation.next_step_suggestion && (
        <div style={{ fontSize: 12, color: "var(--v-accent)", fontWeight: 600, lineHeight: 1.5 }}>
          → {conversation.next_step_suggestion}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `TelegramBusinessThread.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { TelegramConversation, TelegramMessage } from "@/lib/types";

/** Мастерская's live Telegram thread -- messages the client actually sent
 * to the manager's own Telegram Business account, relayed here. The bot's
 * draft reply is always a suggestion, never auto-sent: a manager can edit
 * it, send it as-is, or clear it and write their own from scratch --
 * same "review-after" posture as справка approval, never bypassed. */
export function TelegramBusinessThread({
  conversation, messages, onSent,
}: {
  conversation: TelegramConversation | null;
  messages: TelegramMessage[];
  /** Called after a successful send so the parent can refetch and pick up
   * the now-cleared draft + the new outbound message. */
  onSent: () => void;
}) {
  const [draftText, setDraftText] = useState(conversation?.draft_reply || "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // A fresh incoming message regenerates the draft server-side -- pick that
  // up here unless nothing's changed (avoids clobbering mid-edit text on
  // unrelated re-renders, since this only fires when the draft itself changes).
  useEffect(() => {
    setDraftText(conversation?.draft_reply || "");
  }, [conversation?.draft_reply, conversation?.id]);

  async function send(text: string) {
    if (!conversation || !text.trim()) return;
    setSending(true);
    setError("");
    try {
      await api.telegramSendReply(conversation.id, text.trim());
      onSent();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  if (!conversation) {
    return (
      <div className="glass-panel" style={{ padding: "16px 18px" }}>
        <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Клиент ещё не писал в Telegram.</div>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(150deg, #2AABEE, #229ED9)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="#fff"><path d="M21.94 4.53 18.6 20.2c-.25 1.12-.9 1.4-1.83.87l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.02.5l.36-5.15L18.1 6.9c.4-.36-.09-.56-.63-.2L7.4 13.3l-5-1.57c-1.1-.34-1.12-1.1.23-1.63L20.6 3.5c.9-.34 1.7.2 1.34 1.03Z" /></svg>
        </span>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>Telegram</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 280, overflowY: "auto" }}>
        {messages.map((m) => (
          <div key={m.id} style={{ display: "flex", flexDirection: m.direction === "inbound" ? "row" : "row-reverse" }}>
            <div style={{
              maxWidth: "76%", padding: "10px 13px", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap",
              background: m.direction === "inbound" ? "rgba(255,255,255,.05)" : "var(--v-accent)",
              color: m.direction === "inbound" ? "var(--color-text)" : "var(--v-text-on-accent)",
              border: m.direction === "inbound" ? "1px solid var(--color-hairline-soft)" : "none",
              borderRadius: m.direction === "inbound" ? "4px 15px 15px 15px" : "15px 15px 4px 15px",
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {messages.length === 0 && <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Переписки пока нет.</div>}
      </div>

      {error && <div style={{ fontSize: 12, color: "var(--danger)" }}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid var(--color-hairline-soft)" }}>
        <textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder="Ответ клиенту…"
          rows={3}
          style={{ width: "100%", resize: "vertical", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 10, color: "var(--color-text)", fontSize: 13, padding: "9px 12px", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="press" disabled={sending || !draftText.trim()} onClick={() => send(draftText)}
            style={{ padding: "8px 16px", borderRadius: 99, background: "var(--v-accent)", color: "var(--v-text-on-accent)", fontSize: 12.5, fontWeight: 700, border: "none", cursor: "pointer", opacity: sending || !draftText.trim() ? 0.6 : 1 }}
          >
            {sending ? "Отправляю…" : "Отправить"}
          </button>
          {conversation.draft_reply && draftText === conversation.draft_reply && (
            <button
              className="press" onClick={() => setDraftText("")}
              style={{ padding: "8px 16px", borderRadius: 99, background: "transparent", color: "var(--color-text-soft)", fontSize: 12.5, fontWeight: 600, border: "1px solid var(--color-hairline)", cursor: "pointer" }}
            >
              Написать своё
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0 (both components are not yet imported anywhere, so this only checks their own internal correctness)

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/TelegramSummaryCard.tsx src/components/TelegramBusinessThread.tsx
git commit -m "feat(telegram): add TelegramBusinessThread + TelegramSummaryCard components"
```

---

## Task 8: wire it into `ClientWorkspace.tsx`, remove the fake preview

**Files:**
- Modify: `frontend/src/components/ClientWorkspace.tsx`
- Delete: `frontend/src/components/TelegramPreviewModal.tsx`

- [ ] **Step 1: Swap the imports**

In `frontend/src/components/ClientWorkspace.tsx`, replace:

```tsx
import { Building, ClientDetail, PRIORITY_COLORS, PRIORITY_LABELS, Priority, STAGE_COLORS, STATUS_LABELS, PLAN_LABELS, PlanRate, Unit } from "@/lib/types";
import { ChatThread } from "./ChatThread";
import { DealTimeline } from "./DealTimeline";
import { Dropdown } from "./Dropdown";
import { TelegramPreviewModal } from "./TelegramPreviewModal";
```

with:

```tsx
import { Building, ClientDetail, PRIORITY_COLORS, PRIORITY_LABELS, Priority, STAGE_COLORS, STATUS_LABELS, PLAN_LABELS, PlanRate, TelegramConversation, TelegramMessage, Unit } from "@/lib/types";
import { ChatThread } from "./ChatThread";
import { DealTimeline } from "./DealTimeline";
import { Dropdown } from "./Dropdown";
import { TelegramBusinessThread } from "./TelegramBusinessThread";
import { TelegramSummaryCard } from "./TelegramSummaryCard";
```

- [ ] **Step 2: Replace `cortegePreviewOpen` with real Telegram state**

Replace:

```tsx
  const [cortegePreviewOpen, setCortegePreviewOpen] = useState(false);
```

with:

```tsx
  const [telegramConversation, setTelegramConversation] = useState<TelegramConversation | null>(null);
  const [telegramMessages, setTelegramMessages] = useState<TelegramMessage[]>([]);
```

- [ ] **Step 3: Fetch Telegram data alongside the existing client/conversation fetch, and add a refetch helper**

Replace:

```tsx
  useEffect(() => {
    setSelected(null);
    setConversationId(null);
    setSpravkaMode(false);
    setFormOpen(false);
    setRequestedPrice("");
    (async () => {
      const [detail, conv] = await Promise.all([api.clientDetail(clientId), api.clientConversation(clientId)]);
      setSelected(detail);
      setConversationId(conv.id);
    })();
  }, [clientId]);
```

with:

```tsx
  useEffect(() => {
    setSelected(null);
    setConversationId(null);
    setSpravkaMode(false);
    setFormOpen(false);
    setRequestedPrice("");
    setTelegramConversation(null);
    setTelegramMessages([]);
    (async () => {
      const [detail, conv, tg] = await Promise.all([
        api.clientDetail(clientId), api.clientConversation(clientId), api.telegramByClient(clientId),
      ]);
      setSelected(detail);
      setConversationId(conv.id);
      setTelegramConversation(tg.conversation);
      setTelegramMessages(tg.messages);
    })();
  }, [clientId]);

  async function refreshTelegram() {
    const tg = await api.telegramByClient(clientId);
    setTelegramConversation(tg.conversation);
    setTelegramMessages(tg.messages);
  }
```

- [ ] **Step 4: Replace the Cortège+ teaser block with the real thread**

Replace the entire block (currently reads "Cortège+" / "СКОРО" / the dashed-border teaser card with "Показать бета-превью"):

```tsx
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)" }}>Cortège+</div>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".04em", color: "#fff", background: "linear-gradient(150deg, #22d3ee, #6366f1)", borderRadius: 99, padding: "2px 7px" }}>СКОРО</span>
          </div>
          <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,.03)", border: "1px dashed var(--color-hairline)" }}>
            <div style={{ fontSize: 12, color: "var(--color-text-faint)", lineHeight: 1.5, marginBottom: 10 }}>
              Платформа Cortège — бот сам отвечает клиенту в Telegram. Здесь, в Мастерской, вы сможете следить за перепиской в реальном времени, а AI-ассистент рядом читает её и продолжает советовать по этой сделке в чате. Пока интеграция не подключена — это превью того, как будет выглядеть.
            </div>
            <button
              className="press"
              onClick={() => setCortegePreviewOpen(true)}
              style={{
                display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                padding: "7px 12px", borderRadius: 9, border: "none", color: "#fff",
                background: "linear-gradient(150deg, #2AABEE, #229ED9)",
              }}
            >
              <svg viewBox="0 0 24 24" width={13} height={13} fill="#fff"><path d="M21.94 4.53 18.6 20.2c-.25 1.12-.9 1.4-1.83.87l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.02.5l.36-5.15L18.1 6.9c.4-.36-.09-.56-.63-.2L7.4 13.3l-5-1.57c-1.1-.34-1.12-1.1.23-1.63L20.6 3.5c.9-.34 1.7.2 1.34 1.03Z" /></svg>
              Показать бета-превью
            </button>
          </div>
        </div>
```

with:

```tsx
        <TelegramBusinessThread
          conversation={telegramConversation} messages={telegramMessages}
          onSent={refreshTelegram}
        />
```

- [ ] **Step 5: Add the summary card above the AI chat in the right column, and drop the modal**

Replace:

```tsx
      <div className="glass-panel" style={{ width: 340, flexShrink: 0, minHeight: 0, padding: "18px 20px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 13.5, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
          Чат · {selected.name || selected.phone}
        </div>
        <div style={{ flex: 1, minHeight: 0, paddingTop: 10 }}>
          {conversationId ? (
            <ChatThread
              conversationId={conversationId} isBoss={isBoss} spravkaMode={spravkaMode}
              onSpravkaCreated={() => setSpravkaMode(false)}
              greeting={`Что нужно по клиенту ${selected.name || selected.phone}? Могу оформить справку, посоветовать план оплаты или подсказать следующий шаг по сделке.`}
            />
          ) : (
            <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка чата…</div>
          )}
        </div>
      </div>
      {cortegePreviewOpen && (
        <TelegramPreviewModal clientName={selected.name || selected.phone} onClose={() => setCortegePreviewOpen(false)} />
      )}
    </div>
  );
}
```

with:

```tsx
      <div className="glass-panel" style={{ width: 340, flexShrink: 0, minHeight: 0, padding: "18px 20px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 13.5, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
          Чат · {selected.name || selected.phone}
        </div>
        <div style={{ flex: 1, minHeight: 0, paddingTop: 10, overflowY: "auto" }}>
          <TelegramSummaryCard conversation={telegramConversation} />
          {conversationId ? (
            <ChatThread
              conversationId={conversationId} isBoss={isBoss} spravkaMode={spravkaMode}
              onSpravkaCreated={() => setSpravkaMode(false)}
              greeting={`Что нужно по клиенту ${selected.name || selected.phone}? Могу оформить справку, посоветовать план оплаты или подсказать следующий шаг по сделке.`}
            />
          ) : (
            <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка чата…</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Delete the fake preview**

```bash
rm frontend/src/components/TelegramPreviewModal.tsx
```

- [ ] **Step 7: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0

Run: `cd frontend && npx next build`
Expected: `✓ Compiled successfully`, exit code 0

- [ ] **Step 8: Commit**

```bash
cd frontend
git add src/components/ClientWorkspace.tsx
git rm src/components/TelegramPreviewModal.tsx
git commit -m "feat(telegram): wire real Telegram thread into ClientWorkspace, drop fake preview"
```

---

## Task 9: discovery + linking for unmatched Telegram conversations

A new message from a client Telegram doesn't recognize (no `client_id` yet) needs somewhere to surface — not boss-gated, since any rep might need to link a new contact, matching how pinning a client already isn't boss-restricted in this file.

**Files:**
- Modify: `frontend/src/components/WorkshopPanel.tsx`

- [ ] **Step 1: Add the import and new state**

Replace:

```tsx
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Client } from "@/lib/types";
import { ClientWorkspace } from "./ClientWorkspace";
import { Skeleton } from "./Skeleton";
import { SpravkaApprovalTable } from "./SpravkaApprovalTable";
```

with:

```tsx
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Client, TelegramConversation } from "@/lib/types";
import { ClientWorkspace } from "./ClientWorkspace";
import { Skeleton } from "./Skeleton";
import { SpravkaApprovalTable } from "./SpravkaApprovalTable";
```

Replace:

```tsx
  const [pinned, setPinned] = useState<Client[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [allClients, setAllClients] = useState<Client[] | null>(null);
  const [showAllRequests, setShowAllRequests] = useState(false);

  useEffect(() => { api.workspace().then(setPinned).catch(() => setPinned([])); }, []);
```

with:

```tsx
  const [pinned, setPinned] = useState<Client[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [allClients, setAllClients] = useState<Client[] | null>(null);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [unmatchedTelegram, setUnmatchedTelegram] = useState<TelegramConversation[] | null>(null);
  const [recentMatchedTelegram, setRecentMatchedTelegram] = useState<
    (TelegramConversation & { clients: { name: string | null; phone: string } | null })[] | null
  >(null);
  // Which unmatched conversation the inline "attach to client" picker is open
  // for -- reuses the same allClients/pin machinery the main search box
  // already has, just a second entry point into it.
  const [linkingConvId, setLinkingConvId] = useState<string | null>(null);
  const [linkQuery, setLinkQuery] = useState("");

  useEffect(() => { api.workspace().then(setPinned).catch(() => setPinned([])); }, []);
  useEffect(() => { api.telegramUnmatched().then(setUnmatchedTelegram).catch(() => setUnmatchedTelegram([])); }, []);
  useEffect(() => { api.telegramRecentMatched().then(setRecentMatchedTelegram).catch(() => setRecentMatchedTelegram([])); }, []);
```

- [ ] **Step 2: Add the linking handler, next to the existing `pin`/`unpin` functions**

After the existing `unpin` function (`async function unpin(clientId: string) { ... }`), add:

```tsx
  async function linkTelegramToClient(client: Client) {
    if (!linkingConvId) return;
    await api.telegramLinkConversation(linkingConvId, { client_id: client.id });
    setUnmatchedTelegram((cur) => (cur || []).filter((c) => c.id !== linkingConvId));
    setLinkingConvId(null);
    setLinkQuery("");
    pin(client);
  }

  async function linkTelegramToNewClient(name: string, phone: string) {
    if (!linkingConvId) return;
    const updated = await api.telegramLinkConversation(linkingConvId, { new_client_name: name, new_client_phone: phone });
    setUnmatchedTelegram((cur) => (cur || []).filter((c) => c.id !== linkingConvId));
    setLinkingConvId(null);
    setLinkQuery("");
    if (updated.client_id) await openRecentTelegramClient(updated.client_id);
  }

  async function openRecentTelegramClient(clientId: string) {
    await api.pinToWorkspace(clientId).catch(() => {});
    api.workspace().then(setPinned).catch(() => {});
    setSelectedId(clientId);
  }
```

- [ ] **Step 3: Make sure `allClients` loads even if the main search box was never touched**

Immediately after the `linkTelegramToClient`/`linkTelegramToNewClient` functions, add:

```tsx
  useEffect(() => {
    if (linkingConvId && !allClients) api.clients().then(setAllClients).catch(() => {});
  }, [linkingConvId, allClients]);
```

- [ ] **Step 4: Render the unmatched-conversations section, and the matched-but-unpinned one**

Find the existing `unpinnedApprovals` render block (starts with `{unpinnedApprovals.length > 0 && (` and ends with the closing `)}` right before the `<div>` that starts the "В работе" section). Immediately **after** that block (still before "В работе"), add both of the following (matched-but-unpinned first, since a message from someone already a real client is more actionable than an unmatched stranger):

```tsx
      {recentMatchedTelegram && recentMatchedTelegram.filter((c) => c.client_id && !pinnedIds.has(c.client_id)).length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "#2AABEE", marginBottom: 10 }}>
            Новое в Telegram — {recentMatchedTelegram.filter((c) => c.client_id && !pinnedIds.has(c.client_id)).length}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {recentMatchedTelegram.filter((c) => c.client_id && !pinnedIds.has(c.client_id)).map((c) => (
              <div
                key={c.id}
                onClick={() => openRecentTelegramClient(c.client_id!)}
                className="glass-panel press"
                style={{ padding: "13px 15px", cursor: "pointer", boxShadow: "0 0 0 1px color-mix(in srgb, #2AABEE 40%, transparent)" }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
                  {c.clients?.name || c.clients?.phone || "Клиент"}
                </div>
                <div style={{ fontSize: 11, color: "#2AABEE", marginTop: 3 }}>Новое сообщение в Telegram</div>
              </div>
            ))}
          </div>
        </div>
      )}

```tsx
      {unmatchedTelegram && unmatchedTelegram.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "#2AABEE", marginBottom: 10 }}>
            Непривязанные Telegram-чаты — {unmatchedTelegram.length}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {unmatchedTelegram.map((c) => (
              <div key={c.id} style={{ position: "relative" }}>
                <div
                  onClick={() => setLinkingConvId(linkingConvId === c.id ? null : c.id)}
                  className="glass-panel press"
                  style={{ padding: "13px 15px", cursor: "pointer", boxShadow: "0 0 0 1px color-mix(in srgb, #2AABEE 40%, transparent)" }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
                    {c.telegram_first_name || c.telegram_username || "Без имени"}
                  </div>
                  <div style={{ fontSize: 11, color: "#2AABEE", marginTop: 3 }}>Кто это? Нажмите, чтобы привязать</div>
                </div>
                {linkingConvId === c.id && (
                  <div className="glass-panel" style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 6, zIndex: 10, padding: 10 }}>
                    <input
                      autoFocus
                      value={linkQuery}
                      onChange={(e) => setLinkQuery(e.target.value)}
                      placeholder="Имя или телефон существующего клиента…"
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 12.5, marginBottom: 8 }}
                    />
                    {linkQuery.trim() && (allClients || [])
                      .filter((cl) => (cl.name || "").toLowerCase().includes(linkQuery.trim().toLowerCase()) || cl.phone.includes(linkQuery.trim()))
                      .slice(0, 5)
                      .map((cl) => (
                        <div
                          key={cl.id} onClick={() => linkTelegramToClient(cl)} className="press"
                          style={{ padding: "7px 9px", borderRadius: 7, cursor: "pointer", fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 8 }}
                        >
                          <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{cl.name || cl.phone}</span>
                          <span style={{ color: "var(--color-text-faint)", fontSize: 11 }}>{cl.phone}</span>
                        </div>
                      ))}
                    {linkQuery.trim() && /^[+\d][\d\s-]{6,}$/.test(linkQuery.trim()) && (
                      <div
                        onClick={() => linkTelegramToNewClient(c.telegram_first_name || "", linkQuery.trim())}
                        className="press"
                        style={{ padding: "7px 9px", borderRadius: 7, cursor: "pointer", fontSize: 12.5, color: "var(--v-accent)", fontWeight: 700 }}
                      >
                        + Создать нового клиента с этим номером
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0

Run: `cd frontend && npx next build`
Expected: `✓ Compiled successfully`, exit code 0

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/components/WorkshopPanel.tsx
git commit -m "feat(telegram): surface + link unmatched Telegram conversations in Мастерская"
```

---

## Task 10: operator setup + end-to-end verification

**Files:** none (this is the manual setup + verification pass, not code)

- [ ] **Step 1: One-time manual setup (operator, not code)**

1. In BotFather, create a bot (or reuse one), get its token.
2. On the pilot manager's own Telegram account: Settings → Telegram Business → Chatbots → connect the bot created above. This is what makes messages sent to the manager's personal account reachable by the bot.
3. Set these env vars on the backend deployment (and in local `.env` for dev testing): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (any random string you choose).
4. Register the webhook once:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=https://<your-backend-domain>/webhook/telegram-business" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
   Expected: `{"ok":true,"result":true,...}`
5. Insert the connection row (the business-connection id is delivered via the `business_connection` update the first time the manager connects — capture it from a test webhook log, or query `getUpdates` once before the webhook is set, then insert manually):
   ```sql
   insert into public.telegram_business_connections (tenant_id, manager_email, business_connection_id, telegram_user_id)
   values ('<tenant uuid>', '<manager email>', '<business_connection_id from Telegram>', <manager's telegram user id>);
   ```

- [ ] **Step 2: Run the full test suite one more time**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/ -v`
Expected: `10 passed`

Run: `cd backend && .venv/Scripts/python.exe -m py_compile app/routers/telegram_business.py app/telegram/bot_client.py app/telegram/matching.py app/ai/telegram_evaluator.py app/main.py`
Expected: exit code 0

Run: `cd frontend && npx tsc --noEmit && npx next build`
Expected: both exit code 0

- [ ] **Step 3: Live end-to-end check**

1. Have the client (or a test account) send a real message to the manager's Telegram.
2. Confirm a row appears in `telegram_conversations` and `telegram_messages` (query Supabase directly, same pattern used throughout this project's manual verification).
3. Confirm `summary`/`next_step_suggestion`/`draft_reply` are populated within a few seconds.
4. Open that client (or the "Непривязанные Telegram-чаты" card, if the phone wasn't shared) in Мастерская — confirm the message and draft appear, edit the draft, click "Отправить," and confirm the real message actually arrives in the manager's Telegram app.
5. Reply directly from the manager's phone (bypassing Argus) once, and confirm that inbound message also shows up in Мастерская on the next poll/reload (this plan doesn't add real-time push — see "Out of scope" note below).

- [ ] **Step 4: Note what's explicitly deferred**

Not built in this pass (call these out to the user once the above works): live real-time updates in the open `ClientWorkspace` (a manager currently has to leave and reopen the client, or you add simple polling later); a visible "Telegram отключён" warning banner in Обзор for the `business_connection` disconnect case (the backend already persists `is_enabled`/`disconnected_at` correctly — only the UI banner itself isn't wired up in this plan, since no obvious existing "Обзор banner" slot was in scope for this pass without touching `AssistantPanel.tsx`'s Обзор view, which is a separate concern).

