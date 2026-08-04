# Argus Brain — Phase 0+1: shared context layer + Мастерская advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared `app/ai/brain.py` context-assembly layer and use it to fix the concrete problem that started this spec: Мастерская's right-hand panel currently shows two disconnected AI voices (a boxed "Итог диалога" card with no view of the client's Telegram thread, plus a separate Q&A chat that can't see it either) — merge them into one advisor panel with a proactive `coaching_tip` and a context-aware chat.

**Architecture:** One new pure-data module (`app/ai/brain.py`, no OpenAI calls inside it) that both `clients.py`'s handover-summary endpoint and `assistant.py`'s per-client chat call instead of each running their own ad hoc Supabase queries. `telegram_evaluator.py`'s existing single GPT-4o call gains one more structured-output field (`coaching_tip`) — no new API round-trip. Frontend changes are purely presentational (rename + de-nest a card) — no new components.

**Tech Stack:** FastAPI + Supabase (existing conventions: plain `def`, explicit `tenant_id` filtering, no RLS), pytest with hand-rolled fake Supabase clients (matching `tests/test_matching.py`), Next.js/React (no test runner configured for frontend in this repo — verify via dev server, matching this repo's existing convention).

**Scope note:** This is Phase 0+1 of the full `docs/superpowers/specs/2026-08-05-argus-brain-design.md` spec (per the user's explicit build order: advisor first). Phases 2-5 (stage-based reminders, daily briefing, owner live summary, help chatbot) are independently shippable and get their own follow-up plan docs once this one ships — each phase builds on `brain.py` but doesn't require the others.

---

### Task 1: `app/ai/brain.py` — `gather_client_context`

**Files:**
- Create: `backend/app/ai/brain.py`
- Test: `backend/tests/test_brain.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_brain.py
from app.ai import brain


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = list(rows)

    def select(self, *a, **k):
        return self

    def eq(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) == value]
        return self

    def order(self, *a, **k):
        return self

    def execute(self):
        return _FakeResult(self._rows)


class _FakeClient:
    def __init__(self, tables: dict):
        self._tables = tables

    def table(self, name):
        return _FakeQuery(self._tables.get(name, []))


def test_gather_client_context_returns_empty_dict_when_client_not_found():
    fake = _FakeClient({"clients": []})
    assert brain.gather_client_context(fake, "tenant-1", "client-1") == {}


def test_gather_client_context_assembles_full_picture():
    fake = _FakeClient({
        "clients": [{
            "id": "client-1", "tenant_id": "tenant-1", "name": "Сардор",
            "phone": "+998911110001", "priority": "hot", "next_followup_note": "перезвонить в среду",
        }],
        "leads": [{
            "client_id": "client-1", "stage": "matching", "source": "instagram",
            "buy_intent": None, "created_at": "2026-08-01T00:00:00Z",
        }],
        "spravka_requests": [{
            "client_id": "client-1", "status": "pending", "plan_type": "installment",
            "created_at": "2026-08-02T00:00:00Z",
        }],
        "telegram_conversations": [{
            "client_id": "client-1", "tenant_id": "tenant-1",
            "summary": "Спросил про Milano, бюджет до 100к", "next_step_suggestion": "Уточнить площадь",
        }],
    })
    ctx = brain.gather_client_context(fake, "tenant-1", "client-1")
    assert ctx["name"] == "Сардор"
    assert ctx["phone"] == "+998911110001"
    assert ctx["priority"] == "hot"
    assert ctx["next_followup_note"] == "перезвонить в среду"
    assert len(ctx["leads"]) == 1 and ctx["leads"][0]["stage"] == "matching"
    assert len(ctx["spravka_requests"]) == 1
    assert ctx["telegram_summary"]["summary"] == "Спросил про Milano, бюджет до 100к"


def test_gather_client_context_no_telegram_conversation_is_none_not_missing_key():
    fake = _FakeClient({
        "clients": [{
            "id": "client-1", "tenant_id": "tenant-1", "name": None,
            "phone": "+998911110002", "priority": None, "next_followup_note": None,
        }],
        "leads": [], "spravka_requests": [], "telegram_conversations": [],
    })
    ctx = brain.gather_client_context(fake, "tenant-1", "client-1")
    assert ctx["telegram_summary"] is None


def test_gather_client_context_only_returns_leads_for_this_client():
    fake = _FakeClient({
        "clients": [{
            "id": "client-1", "tenant_id": "tenant-1", "name": "A",
            "phone": "+1", "priority": None, "next_followup_note": None,
        }],
        "leads": [
            {"client_id": "client-1", "stage": "matching", "source": None, "buy_intent": None, "created_at": "2026-08-01T00:00:00Z"},
            {"client_id": "client-2", "stage": "reserved", "source": None, "buy_intent": None, "created_at": "2026-08-01T00:00:00Z"},
        ],
        "spravka_requests": [], "telegram_conversations": [],
    })
    ctx = brain.gather_client_context(fake, "tenant-1", "client-1")
    assert len(ctx["leads"]) == 1
    assert ctx["leads"][0]["stage"] == "matching"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_brain.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.ai.brain'`

- [ ] **Step 3: Write the implementation**

```python
# backend/app/ai/brain.py
"""Argus Brain -- the shared context-assembly layer behind every AI call-site
in the app. Pure data gathering, no OpenAI calls in this module: each
consumer (client_context.py's handover summary, assistant.py's per-client
chat, telegram_evaluator.py's coaching tip, and later the daily-briefing/
owner-summary consumers from later phases) still owns its own prompt and
trust model. This module exists so they all read the same facts instead of
each running slightly different ad hoc Supabase queries -- see
docs/superpowers/specs/2026-08-05-argus-brain-design.md for the full
rationale (the "two AI voices" confusion this was built to fix).
"""


def gather_client_context(client, tenant_id: str, client_id: str) -> dict:
    """Everything Argus currently knows about one client: identity, leads,
    справки, and their live Telegram conversation (summary + next-step, if
    any). Returns {} if the client doesn't exist for this tenant -- callers
    check for that rather than getting a KeyError deep in a prompt template.

    Meeting notes (Phase 2 of the Argus Brain spec) aren't wired in yet --
    that table doesn't exist until then; this function will grow a
    `meeting_notes` key once it does, not before.
    """
    row = (
        client.table("clients").select("*")
        .eq("id", client_id).eq("tenant_id", tenant_id).execute().data
    )
    if not row:
        return {}
    c = row[0]
    leads = (
        client.table("leads").select("stage, source, buy_intent, created_at, buildings(name)")
        .eq("client_id", client_id).order("created_at", desc=True).execute().data
    )
    spravki = (
        client.table("spravka_requests")
        .select("status, plan_type, created_at, units(unit_number, buildings(name))")
        .eq("client_id", client_id).order("created_at", desc=True).execute().data
    )
    telegram = (
        client.table("telegram_conversations").select("summary, next_step_suggestion")
        .eq("client_id", client_id).eq("tenant_id", tenant_id).execute().data
    )
    return {
        "name": c.get("name"), "phone": c["phone"], "priority": c.get("priority"),
        "next_followup_note": c.get("next_followup_note"),
        "leads": leads, "spravka_requests": spravki,
        "telegram_summary": telegram[0] if telegram else None,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_brain.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/ai/brain.py tests/test_brain.py
git commit -m "feat: add Argus Brain shared context layer (gather_client_context)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Refactor `clients.py`'s handover summary to use `gather_client_context`

**Files:**
- Modify: `backend/app/routers/clients.py:161-190`

- [ ] **Step 1: Replace the inline query block with a call to `brain.gather_client_context`**

Current code at `backend/app/routers/clients.py:161-190`:

```python
def refresh_context_summary(client_id: str, user=Depends(get_current_user)):
    """Manager-handover problem: whoever inherits a departed agent's clients
    has no idea what's been discussed. On-demand (not automatic on every
    event, keeps this cheap and simple) -- a manager clicks "Обновить
    сводку" and gets a fresh 2-4 sentence brief synthesized from everything
    known about this client."""
    client = get_service_client()
    res = client.table("clients").select("*").eq("id", client_id).eq("tenant_id", user.tenant_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Client not found")
    c = res.data[0]
    leads = (
        client.table("leads").select("stage, source, buy_intent, created_at, buildings(name)")
        .eq("client_id", client_id).order("created_at", desc=True).execute().data
    )
    spravki = (
        client.table("spravka_requests")
        .select("status, plan_type, created_at, units(unit_number, buildings(name))")
        .eq("client_id", client_id).order("created_at", desc=True).execute().data
    )
    telegram = (
        client.table("telegram_conversations").select("summary, next_step_suggestion")
        .eq("client_id", client_id).eq("tenant_id", user.tenant_id).execute().data
    )
    context_data = {
        "name": c.get("name"), "phone": c["phone"], "priority": c.get("priority"),
        "next_followup_note": c.get("next_followup_note"),
        "leads": leads, "spravka_requests": spravki,
        "telegram_summary": telegram[0] if telegram else None,
    }
    try:
        summary = summarize_client_context(context_data)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось обновить сводку — попробуйте ещё раз")
    updated = client.table("clients").update({
        "ai_context_summary": summary, "ai_context_generated_at": datetime.now(timezone.utc).isoformat(),
```

Replace with:

```python
def refresh_context_summary(client_id: str, user=Depends(get_current_user)):
    """Manager-handover problem: whoever inherits a departed agent's clients
    has no idea what's been discussed. On-demand (not automatic on every
    event, keeps this cheap and simple) -- a manager clicks "Обновить
    сводку" and gets a fresh 2-4 sentence brief synthesized from everything
    known about this client."""
    client = get_service_client()
    context_data = gather_client_context(client, user.tenant_id, client_id)
    if not context_data:
        raise HTTPException(status_code=404, detail="Client not found")
    try:
        summary = summarize_client_context(context_data)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось обновить сводку — попробуйте ещё раз")
    updated = client.table("clients").update({
        "ai_context_summary": summary, "ai_context_generated_at": datetime.now(timezone.utc).isoformat(),
```

(The rest of the function, the `.eq(...).execute()` call and `return updated[0]` below it, is unchanged — only the block building `context_data` is replaced.)

- [ ] **Step 2: Add the import**

At `backend/app/routers/clients.py:13`, current line:

```python
from app.ai.client_context import summarize_client_context
```

Change to:

```python
from app.ai.brain import gather_client_context
from app.ai.client_context import summarize_client_context
```

- [ ] **Step 3: Typecheck/import-check the backend still starts cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0 (import succeeds — this catches typos/syntax errors without needing a running server)

- [ ] **Step 4: Commit**

```bash
cd backend
git add app/routers/clients.py
git commit -m "refactor: clients.py handover summary uses Argus Brain

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `client_context_prompt` gains a `telegram_summary` param; `assistant.py`'s chat context uses `gather_client_context`

**Files:**
- Modify: `backend/app/ai/prompts.py:73-95`
- Modify: `backend/app/routers/assistant.py:18, 56-67`

- [ ] **Step 1: Extend `client_context_prompt`**

Current code at `backend/app/ai/prompts.py:73-95`:

```python
def client_context_prompt(name: str | None, phone: str, leads: list[dict], spravki: list[dict]) -> str:
    """Appended to the system prompt only inside a client's own profile-chat
    (conversations.client_id set) -- gives the model that person's real
    history instead of generic advice, so "посоветуй, как продать" actually
    reasons over their real stage/справки rather than made-up context."""
    lines = [f"\n\nКОНТЕКСТ КЛИЕНТА: этот разговор целиком про одного клиента — {name or phone} ({phone})."]
    if leads:
        lines.append("Лиды: " + "; ".join(
            f"{l['stage']}" + (f" · {l['source']}" if l.get("source") else "") for l in leads
        ))
    if spravki:
        lines.append("Справки: " + "; ".join(
            f"№{s['units']['unit_number']} {s['units']['buildings']['name']} — {s['status']}"
            for s in spravki if s.get("units")
        ))
    if not leads and not spravki:
        lines.append("Пока нет ни лидов, ни справок на этого клиента в базе.")
    lines.append(
        "Используй эту историю для конкретных советов по продаже именно этому "
        "клиенту, а не общих фраз. Все обычные функции (get_units, "
        "create_spravka_request и т.д.) по-прежнему доступны."
    )
    return "\n".join(lines)
```

Replace with:

```python
def client_context_prompt(
    name: str | None, phone: str, leads: list[dict], spravki: list[dict],
    telegram_summary: str | None = None,
) -> str:
    """Appended to the system prompt only inside a client's own profile-chat
    (conversations.client_id set) -- gives the model that person's real
    history instead of generic advice, so "посоветуй, как продать" actually
    reasons over their real stage/справки/live Telegram conversation rather
    than made-up context. `telegram_summary` was added so this chat can see
    what's actually being discussed with the client right now, not just
    formal leads/справки records (previously the chat had no view of the
    Telegram thread at all -- flagged directly during the 2026-08-05
    brainstorm as one AI voice not seeing what another already knew)."""
    lines = [f"\n\nКОНТЕКСТ КЛИЕНТА: этот разговор целиком про одного клиента — {name or phone} ({phone})."]
    if leads:
        lines.append("Лиды: " + "; ".join(
            f"{l['stage']}" + (f" · {l['source']}" if l.get("source") else "") for l in leads
        ))
    if spravki:
        lines.append("Справки: " + "; ".join(
            f"№{s['units']['unit_number']} {s['units']['buildings']['name']} — {s['status']}"
            for s in spravki if s.get("units")
        ))
    if not leads and not spravki:
        lines.append("Пока нет ни лидов, ни справок на этого клиента в базе.")
    if telegram_summary:
        lines.append(f"Текущая переписка в Telegram: {telegram_summary}")
    lines.append(
        "Используй эту историю для конкретных советов по продаже именно этому "
        "клиенту, а не общих фраз. Все обычные функции (get_units, "
        "create_spravka_request и т.д.) по-прежнему доступны."
    )
    return "\n".join(lines)
```

- [ ] **Step 2: Update `assistant.py`'s import and `_client_context_suffix`**

Current code at `backend/app/routers/assistant.py:18`:

```python
from app.ai.prompts import BOSS_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT, SPRAVKA_MODE_SUFFIX, client_context_prompt
```

Change to:

```python
from app.ai.brain import gather_client_context
from app.ai.prompts import BOSS_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT, SPRAVKA_MODE_SUFFIX, client_context_prompt
```

Current code at `backend/app/routers/assistant.py:56-67`:

```python
def _client_context_suffix(client, tenant_id: str, client_id: str | None) -> str:
    if not client_id:
        return ""
    row = client.table("clients").select("name, phone").eq("id", client_id).eq("tenant_id", tenant_id).execute().data
    if not row:
        return ""
    leads = client.table("leads").select("stage, source").eq("client_id", client_id).execute().data
    spravki = (
        client.table("spravka_requests").select("status, units(unit_number, buildings(name))")
        .eq("client_id", client_id).execute().data
    )
    return client_context_prompt(row[0]["name"], row[0]["phone"], leads, spravki)
```

Replace with:

```python
def _client_context_suffix(client, tenant_id: str, client_id: str | None) -> str:
    if not client_id:
        return ""
    ctx = gather_client_context(client, tenant_id, client_id)
    if not ctx:
        return ""
    telegram_summary = ctx["telegram_summary"]["summary"] if ctx["telegram_summary"] else None
    return client_context_prompt(ctx["name"], ctx["phone"], ctx["leads"], ctx["spravka_requests"], telegram_summary)
```

- [ ] **Step 3: Import-check**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0

- [ ] **Step 4: Commit**

```bash
cd backend
git add app/ai/prompts.py app/routers/assistant.py
git commit -m "feat: Мастерская chat context now includes live Telegram summary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `telegram_evaluator.py` gains `coaching_tip`

**Files:**
- Modify: `backend/app/ai/telegram_evaluator.py`
- Modify: `backend/tests/test_telegram_evaluator.py`

- [ ] **Step 1: Update the failing test first**

In `backend/tests/test_telegram_evaluator.py`, change `test_evaluate_conversation_parses_response_and_maps_roles` (lines 4-38):

Current:
```python
def test_evaluate_conversation_parses_response_and_maps_roles(monkeypatch):
    class FakeMessage:
        content = '{"summary": "s", "next_step": "n", "draft_reply": "d"}'
```

Change to:
```python
def test_evaluate_conversation_parses_response_and_maps_roles(monkeypatch):
    class FakeMessage:
        content = '{"summary": "s", "next_step": "n", "draft_reply": "d", "coaching_tip": "t"}'
```

And the assertion further down (currently `assert result == {"summary": "s", "next_step": "n", "draft_reply": "d"}`):

```python
    assert result == {"summary": "s", "next_step": "n", "draft_reply": "d", "coaching_tip": "t"}
```

(Everything else in this test file is unchanged.)

- [ ] **Step 2: Run tests to verify the change is visible (still passes, since the fake doesn't validate schema yet)**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_telegram_evaluator.py -v`
Expected: PASS (parsing is untyped JSON passthrough — this test doesn't exercise the schema itself, only confirms coaching_tip round-trips through `evaluate_conversation`'s return value unchanged)

- [ ] **Step 3: Add `coaching_tip` to the real schema and prompt**

In `backend/app/ai/telegram_evaluator.py`, current `_SYSTEM_PROMPT` (lines 40-54):

```python
_SYSTEM_PROMPT = """Ты помогаешь агенту по недвижимости разобрать переписку с клиентом в Telegram.
По всей истории переписки дай: краткое резюме (2-3 предложения — о чём был разговор и что хочет
клиент), подсказку следующего шага (что агенту стоит сделать дальше), и черновик ответа клиенту на
его последнее сообщение (вежливый, по делу). Никогда не выдумывай цены, юниты или условия — если
клиент спросил о чём-то конкретном, чего нет в истории переписки, в черновике предложи агенту
уточнить это лично, а не придумывай цифры.

Дополнительно: определи, назвал ли клиент КОНКРЕТНУЮ дату/время визита или встречи (например "приеду
в среду", "могу в субботу после обеда", "давайте завтра в 15:00"). Если да — верни has_event=true,
короткий title (например "Визит клиента" или "Встреча — уточнить квартиру") и event_at в формате
ISO 8601 (с временем; если время не названо, поставь 12:00). Сегодняшняя дата: {today}, используй её
для разрешения относительных дат ("завтра", "в среду"). Если время/дата размыты или это не про визит
клиента (например абстрактное "как-нибудь на неделе"), верни has_event=false и остальные event-поля
null — никогда не выдумывай дату, которой явно не было в переписке.
{inventory_block}"""
```

Replace with:

```python
_SYSTEM_PROMPT = """Ты помогаешь агенту по недвижимости разобрать переписку с клиентом в Telegram.
По всей истории переписки дай: краткое резюме (2-3 предложения — о чём был разговор и что хочет
клиент), подсказку следующего шага (что агенту стоит сделать дальше), и черновик ответа клиенту на
его последнее сообщение (вежливый, по делу). Никогда не выдумывай цены, юниты или условия — если
клиент спросил о чём-то конкретном, чего нет в истории переписки, в черновике предложи агенту
уточнить это лично, а не придумывай цифры.

Дополнительно дай короткий тактический совет агенту по продаже (coaching_tip, 1 предложение) —
конкретную реакцию на то, что только что написал клиент (например "клиент упомянул бюджет — предложи
вариант с рассрочкой" или "клиент долго не отвечал — стоит уточнить, актуален ли интерес"). Это не
черновик ответа клиенту, а совет самому агенту, как вести разговор дальше.

Дополнительно: определи, назвал ли клиент КОНКРЕТНУЮ дату/время визита или встречи (например "приеду
в среду", "могу в субботу после обеда", "давайте завтра в 15:00"). Если да — верни has_event=true,
короткий title (например "Визит клиента" или "Встреча — уточнить квартиру") и event_at в формате
ISO 8601 (с временем; если время не названо, поставь 12:00). Сегодняшняя дата: {today}, используй её
для разрешения относительных дат ("завтра", "в среду"). Если время/дата размыты или это не про визит
клиента (например абстрактное "как-нибудь на неделе"), верни has_event=false и остальные event-поля
null — никогда не выдумывай дату, которой явно не было в переписке.
{inventory_block}"""
```

Current `_SCHEMA` (lines 62-85):

```python
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
                "has_event": {"type": "boolean"},
                "event_title": {"type": ["string", "null"]},
                "event_at": {"type": ["string", "null"]},
                "event_note": {"type": ["string", "null"]},
            },
            "required": [
                "summary", "next_step", "draft_reply",
                "has_event", "event_title", "event_at", "event_note",
            ],
            "additionalProperties": False,
        },
        "strict": True,
    },
}
```

Replace with:

```python
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
                "coaching_tip": {"type": "string"},
                "has_event": {"type": "boolean"},
                "event_title": {"type": ["string", "null"]},
                "event_at": {"type": ["string", "null"]},
                "event_note": {"type": ["string", "null"]},
            },
            "required": [
                "summary", "next_step", "draft_reply", "coaching_tip",
                "has_event", "event_title", "event_at", "event_note",
            ],
            "additionalProperties": False,
        },
        "strict": True,
    },
}
```

Also update the module docstring's return-value description at the top (line ~93-94, inside `evaluate_conversation`'s docstring): change

```python
    Returns {"summary", "next_step", "draft_reply", "has_event",
    "event_title", "event_at", "event_note"}.
```

to

```python
    Returns {"summary", "next_step", "draft_reply", "coaching_tip",
    "has_event", "event_title", "event_at", "event_note"}.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_telegram_evaluator.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
cd backend
git add app/ai/telegram_evaluator.py tests/test_telegram_evaluator.py
git commit -m "feat: telegram_evaluator gains a proactive coaching_tip

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Migration — `telegram_conversations.coaching_tip`

**Files:**
- Create: `backend/supabase/migrations/0025_telegram_coaching_tip.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Мастерская advisor (Argus Brain Phase 1): telegram_evaluator now returns a
-- proactive coaching_tip alongside summary/next_step/draft_reply -- same
-- storage pattern as those three (overwritten each new inbound message, a
-- snapshot not a history, see 0019_telegram_business.sql).
alter table public.telegram_conversations add column coaching_tip text;
```

- [ ] **Step 2: Push the migration**

Run: `cd backend && npx.cmd supabase db push --linked`
Expected: `Applying migration 0025_telegram_coaching_tip.sql...` then `"upToDate": false, ... "message": "Finished supabase db push."`

- [ ] **Step 3: Verify the column exists**

Run (PowerShell or bash, reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from `backend/.env`):
```bash
cd backend && SUPABASE_URL=$(grep '^SUPABASE_URL' .env | cut -d= -f2) && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | cut -d= -f2) && curl -s "$SUPABASE_URL/rest/v1/telegram_conversations?select=id,coaching_tip&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: a JSON array (possibly empty `[]`, or rows with `"coaching_tip": null`) — NOT a `42703 column does not exist` error.

- [ ] **Step 4: Commit**

```bash
cd backend
git add supabase/migrations/0025_telegram_coaching_tip.sql
git commit -m "feat: add telegram_conversations.coaching_tip column

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Persist `coaching_tip` in the Telegram webhook

**Files:**
- Modify: `backend/app/routers/telegram_business.py:180-183`

- [ ] **Step 1: Update the persistence block**

Current code at `backend/app/routers/telegram_business.py:180-183`:

```python
            evaluation = evaluate_conversation(history, inventory_context)
            client.table("telegram_conversations").update({
                "summary": evaluation["summary"], "next_step_suggestion": evaluation["next_step"],
                "draft_reply": evaluation["draft_reply"], "draft_generated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", conversation["id"]).execute()
```

Replace with:

```python
            evaluation = evaluate_conversation(history, inventory_context)
            client.table("telegram_conversations").update({
                "summary": evaluation["summary"], "next_step_suggestion": evaluation["next_step"],
                "draft_reply": evaluation["draft_reply"], "coaching_tip": evaluation["coaching_tip"],
                "draft_generated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", conversation["id"]).execute()
```

- [ ] **Step 2: Import-check**

Run: `cd backend && .venv/Scripts/python.exe -c "import app.main"`
Expected: no output, exit code 0

- [ ] **Step 3: Commit**

```bash
cd backend
git add app/routers/telegram_business.py
git commit -m "feat: persist coaching_tip from the Telegram webhook evaluation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend type — `TelegramConversation.coaching_tip`

**Files:**
- Modify: `frontend/src/lib/types.ts:250-264`

- [ ] **Step 1: Add the field**

Current code at `frontend/src/lib/types.ts:250-264`:

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
```

Replace with:

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
  coaching_tip: string | null;
  draft_generated_at: string | null;
  last_message_at: string;
  created_at: string;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (this will show errors in Task 8 until that task's edits land — if run now in isolation, it should still pass since adding an optional-shaped field to a type doesn't break existing consumers that don't reference it)

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/lib/types.ts
git commit -m "feat: add coaching_tip to TelegramConversation type

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Merge the two Мастерская panels into one advisor

**Files:**
- Modify: `frontend/src/components/TelegramSummaryCard.tsx`
- Modify: `frontend/src/components/ClientWorkspace.tsx:424-427`

- [ ] **Step 1: Rewrite `TelegramSummaryCard.tsx`**

Replace the entire file (currently 20 lines, shown in full in the design spec's referenced code) with:

```tsx
"use client";
import { TelegramConversation } from "@/lib/types";

/** Sits flush inside ClientWorkspace's advisor panel, directly above
 * ChatThread -- deliberately NOT its own nested glass-panel anymore (that
 * read as two separate AI voices stacked on top of each other, flagged
 * directly during the 2026-08-05 brainstorm). One panel, one advisor: this
 * is that panel's live-conversation section; the Q&A chat below it is the
 * same advisor, just conversational -- and now shares the same context via
 * app/ai/brain.py's gather_client_context. */
export function TelegramSummaryCard({ conversation }: { conversation: TelegramConversation | null }) {
  if (!conversation || (!conversation.summary && !conversation.next_step_suggestion && !conversation.coaching_tip)) return null;
  return (
    <div style={{ paddingBottom: 12, marginBottom: 12, borderBottom: "1px solid var(--color-hairline-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)" }}>
        Разговор в Telegram
      </div>
      {conversation.summary && (
        <div style={{ fontSize: 12.5, color: "var(--color-text)", lineHeight: 1.5 }}>{conversation.summary}</div>
      )}
      {conversation.coaching_tip && (
        <div style={{ fontSize: 12, color: "var(--v-accent)", fontWeight: 600, lineHeight: 1.5 }}>
          💡 {conversation.coaching_tip}
        </div>
      )}
      {conversation.next_step_suggestion && (
        <div style={{ fontSize: 12, color: "var(--color-text-soft)", lineHeight: 1.5 }}>
          → {conversation.next_step_suggestion}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rename the outer panel header in `ClientWorkspace.tsx`**

Current code at `frontend/src/components/ClientWorkspace.tsx:424-427`:

```tsx
      <div className="glass-panel" style={{ width: 340, flexShrink: 0, minHeight: 0, padding: "18px 20px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 13.5, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
          Чат · {selected.name || selected.phone}
        </div>
```

Replace with:

```tsx
      <div className="glass-panel" style={{ width: 340, flexShrink: 0, minHeight: 0, padding: "18px 20px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 13.5, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
          AI-советник · {selected.name || selected.phone}
        </div>
```

(No other lines in this file change — `TelegramSummaryCard` and `ChatThread` are still rendered in the same order at lines 429-432, just now visually flush instead of card-in-card since `TelegramSummaryCard` no longer wraps itself in `glass-panel`.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/TelegramSummaryCard.tsx src/components/ClientWorkspace.tsx
git commit -m "feat: merge Мастерская's advisor card and chat into one panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all tests pass (existing suite + the new `test_brain.py` + updated `test_telegram_evaluator.py`)

- [ ] **Step 2: Start both dev servers**

Follow the same pattern used earlier this week (absolute `.venv` python path for the backend — a relative path has previously resolved to a stale system Python):

```bash
# backend, from backend/
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8010
```
```bash
# frontend, from frontend/
npm run dev
```

- [ ] **Step 3: Visually confirm the merged panel**

Open a client with an existing Telegram conversation in Мастерская (dev-bypass login, `ENVIRONMENT != production`). Confirm:
- The right panel header reads "AI-советник · {имя}", not "Чат · {имя}"
- The Telegram summary section sits flush at the top (no boxed card border around it) with a hairline divider below it, then the Q&A chat directly beneath — one visual panel, not two stacked cards
- If a `coaching_tip` exists on that conversation, it renders as a 💡 line between summary and next-step

- [ ] **Step 4: Confirm the chat now sees Telegram context**

In the Q&A chat below the advisor section, ask something like "Что происходит с этим клиентом?" for a client with an active Telegram thread. Confirm the reply references the actual Telegram conversation content (not just leads/справки) — this is the concrete fix for the "chat couldn't see the live thread" gap.

- [ ] **Step 5: Push a real message through the webhook (or confirm via logs) to verify `coaching_tip` gets populated end to end**

If a live Telegram test message isn't practical right now, confirm via backend logs that `evaluation["coaching_tip"]` is present and non-empty the next time a real inbound message triggers the webhook — no code change needed here, this step is a confirmation, not a fix.

- [ ] **Step 6: Push to trigger the Railway deploy**

```bash
git push origin main
```

Then poll `railway status` (per this week's established pattern) until both services show `● Online`, and spot-check the same client in Мастерская on the live URL.
