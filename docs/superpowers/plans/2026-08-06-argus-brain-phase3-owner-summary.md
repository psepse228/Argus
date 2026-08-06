# Argus Brain Phase 3 — Owner Live Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the boss an on-demand AI narrative ("Спросить AI") inside the existing "Сводка" tab, built on a new `gather_company_context` cross-manager rollup — the third and final leg of `app/ai/brain.py`.

**Architecture:** `gather_company_context(client, tenant_id)` in `backend/app/ai/brain.py` does pure data assembly (leads by stage, buildings/units summary, all pending справки, today's calendar events tenant-wide) — no AI calls, same contract as `gather_client_context`/`gather_manager_context`. `backend/app/ai/company_summary.py` is a new single-shot GPT-4o structured-output module (same pattern as `daily_briefing.py`/`client_segmentation.py`) that turns those facts into `{"narrative": str, "highlights": [{"label", "detail"}]}`. `backend/app/routers/company_summary.py` exposes it as `POST /api/brain/company-summary`, boss-only, **not cached** — every click calls OpenAI fresh (per the approved design spec: low call volume, one boss, debounced client-side against rapid re-clicks — no `company_summaries` table, no staleness logic, unlike Phase 2b's daily briefing). The frontend adds a "Спросить AI" button + narrative render to the existing summary tab in `AssistantPanel.tsx`.

**Tech Stack:** FastAPI + Supabase (plain `def`, manual tenant scoping), OpenAI GPT-4o strict JSON schema, Next.js/React/TypeScript.

---

## Task 1: `gather_company_context` in `brain.py` + tests

**Files:**
- Modify: `backend/app/ai/brain.py`
- Modify: `backend/tests/test_brain.py`

- [ ] **Step 1: Add the function**

Append to `backend/app/ai/brain.py` (after `gather_manager_context`, before end of file):

```python
def gather_company_context(client, tenant_id: str) -> dict:
    """Cross-manager rollup for the boss's on-demand 'Сводка' AI narrative
    (Phase 3): leads grouped by stage, a per-building units summary, every
    pending справка tenant-wide, and today's calendar events across all
    managers. Same pure data-assembly contract as gather_client_context/
    gather_manager_context -- app/ai/company_summary.py owns the prompt.
    """
    leads = (
        client.table("leads").select("stage")
        .eq("tenant_id", tenant_id).execute().data
    )
    leads_by_stage: dict[str, int] = {}
    for l in leads:
        leads_by_stage[l["stage"]] = leads_by_stage.get(l["stage"], 0) + 1

    buildings = (
        client.table("buildings").select("id, name")
        .eq("tenant_id", tenant_id).execute().data
    )
    units = (
        client.table("units").select("building_id, status, price_per_m2_usd")
        .eq("tenant_id", tenant_id).execute().data
    )
    building_stats = []
    for b in buildings:
        in_building = [u for u in units if u["building_id"] == b["id"]]
        for_sale = [u for u in in_building if u["status"] == "for_sale"]
        prices = [u["price_per_m2_usd"] for u in for_sale if u.get("price_per_m2_usd") is not None]
        building_stats.append({
            "name": b["name"],
            "total_units": len(in_building),
            "for_sale": len(for_sale),
            "min_price_per_m2_usd": min(prices) if prices else None,
        })

    pending_spravki = (
        client.table("spravka_requests")
        .select("*, units(unit_number, buildings(name))")
        .eq("tenant_id", tenant_id).eq("status", "pending").execute().data
    )

    today = datetime.now(timezone.utc).date().isoformat()
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    all_events = (
        client.table("calendar_events").select("*, clients(name, phone)")
        .eq("tenant_id", tenant_id).neq("status", "dismissed").execute().data
    )
    today_events = [e for e in all_events if today <= e["event_at"][:10] < tomorrow]

    return {
        "leads_by_stage": leads_by_stage,
        "buildings": building_stats,
        "pending_spravki": pending_spravki,
        "today_events": today_events,
    }
```

Also update the module's `timedelta` import — `brain.py` currently only imports `datetime, timezone` at the top:

```python
from datetime import datetime, timedelta, timezone
```

- [ ] **Step 2: Write tests**

Append to `backend/tests/test_brain.py` (reuses the existing `_FakeClient`/`_FakeQuery` fakes already in this file — no changes needed there):

```python
def test_gather_company_context_groups_leads_by_stage():
    fake = _FakeClient({
        "leads": [
            {"tenant_id": "tenant-1", "stage": "matching"},
            {"tenant_id": "tenant-1", "stage": "matching"},
            {"tenant_id": "tenant-1", "stage": "reserved"},
            {"tenant_id": "tenant-2", "stage": "reserved"},
        ],
        "buildings": [], "units": [], "spravka_requests": [], "calendar_events": [],
    })
    ctx = brain.gather_company_context(fake, "tenant-1")
    assert ctx["leads_by_stage"] == {"matching": 2, "reserved": 1}


def test_gather_company_context_building_stats_scoped_to_tenant():
    fake = _FakeClient({
        "leads": [],
        "buildings": [{"tenant_id": "tenant-1", "id": "b1", "name": "Milano"}],
        "units": [
            {"tenant_id": "tenant-1", "building_id": "b1", "status": "for_sale", "price_per_m2_usd": 1200},
            {"tenant_id": "tenant-1", "building_id": "b1", "status": "for_sale", "price_per_m2_usd": 1500},
            {"tenant_id": "tenant-1", "building_id": "b1", "status": "sold", "price_per_m2_usd": 1100},
        ],
        "spravka_requests": [], "calendar_events": [],
    })
    ctx = brain.gather_company_context(fake, "tenant-1")
    assert ctx["buildings"] == [{"name": "Milano", "total_units": 3, "for_sale": 2, "min_price_per_m2_usd": 1200}]


def test_gather_company_context_building_with_no_units_for_sale_has_null_price():
    fake = _FakeClient({
        "leads": [],
        "buildings": [{"tenant_id": "tenant-1", "id": "b1", "name": "Milano"}],
        "units": [{"tenant_id": "tenant-1", "building_id": "b1", "status": "sold", "price_per_m2_usd": 1100}],
        "spravka_requests": [], "calendar_events": [],
    })
    ctx = brain.gather_company_context(fake, "tenant-1")
    assert ctx["buildings"][0]["min_price_per_m2_usd"] is None


def test_gather_company_context_pending_spravki_tenant_wide_not_manager_scoped():
    fake = _FakeClient({
        "leads": [], "buildings": [], "units": [],
        "spravka_requests": [
            {"tenant_id": "tenant-1", "requested_by": "Азиз", "status": "pending", "id": "s1"},
            {"tenant_id": "tenant-1", "requested_by": "Другой", "status": "pending", "id": "s2"},
            {"tenant_id": "tenant-1", "requested_by": "Азиз", "status": "approved", "id": "s3"},
            {"tenant_id": "tenant-2", "requested_by": "Азиз", "status": "pending", "id": "s4"},
        ],
        "calendar_events": [],
    })
    ctx = brain.gather_company_context(fake, "tenant-1")
    assert {s["id"] for s in ctx["pending_spravki"]} == {"s1", "s2"}


def test_gather_company_context_today_events_excludes_past_and_future():
    from datetime import datetime, timezone
    today_iso = datetime.now(timezone.utc).date().isoformat()
    fake = _FakeClient({
        "leads": [], "buildings": [], "units": [], "spravka_requests": [],
        "calendar_events": [
            {"tenant_id": "tenant-1", "id": "today", "status": "confirmed", "event_at": f"{today_iso}T10:00:00+00:00"},
            {"tenant_id": "tenant-1", "id": "past", "status": "confirmed", "event_at": "2020-01-01T10:00:00+00:00"},
            {"tenant_id": "tenant-1", "id": "future", "status": "confirmed", "event_at": "2099-01-01T10:00:00+00:00"},
            {"tenant_id": "tenant-1", "id": "today-dismissed", "status": "dismissed", "event_at": f"{today_iso}T11:00:00+00:00"},
        ],
    })
    ctx = brain.gather_company_context(fake, "tenant-1")
    assert {e["id"] for e in ctx["today_events"]} == {"today"}
```

- [ ] **Step 3: Run tests**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_brain.py -v`
Expected: all tests pass (existing `gather_client_context`/`gather_manager_context` tests plus the 5 new ones above).

- [ ] **Step 4: Commit**

```bash
cd backend
git add app/ai/brain.py tests/test_brain.py
git commit -m "feat: add gather_company_context to Argus Brain

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `company_summary.py` AI module + tests

**Files:**
- Create: `backend/app/ai/company_summary.py`
- Create: `backend/tests/test_company_summary.py`

- [ ] **Step 1: Write the module**

```python
"""Single-shot GPT-4o call that turns gather_company_context's tenant-wide
rollup (backend/app/ai/brain.py) into a short narrative for the boss's
on-demand "Сводка" AI summary (Phase 3 of Argus Brain) -- read on click, not
polled, not cached (see docs/superpowers/specs/2026-08-05-argus-brain-design.md,
"Owner live summary"). Same discipline as daily_briefing.py/
client_segmentation.py: never invent a fact that isn't in the input.
"""
import json
import logging
import os

from openai import OpenAI

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


_SYSTEM_PROMPT = """Ты помогаешь руководителю отдела продаж недвижимости понять, как идут дела
прямо сейчас. На входе -- JSON со сводкой по всей компании: количество лидов по стадиям воронки,
список зданий с юнитами в продаже и минимальной ценой за м², все справки, которые ждут решения, и
календарные события на сегодня по всем менеджерам.

Напиши короткую сводку (narrative, 2-4 предложения на русском) -- обычным связным текстом, не
списком: что происходит, что идёт хорошо, на что стоит обратить внимание. Затем дай 2-5 конкретных
пунктов (highlights) с коротким label (например "7 лидов в подборе") и detail (пояснение, почему это
важно, например "Ни один не двигался больше 5 дней").

Правила:
- Используй ТОЛЬКО данные из входного JSON. Никогда не выдумывай числа, здания, лидов или события,
  которых там нет.
- Если справок ждёт решения больше 3 -- обязательно упомяни это как отдельный highlight.
- Если данных мало (например, лидов и событий почти нет), narrative может быть короче, но не
  выдумывай активность, которой не было."""

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "company_summary",
        "schema": {
            "type": "object",
            "properties": {
                "narrative": {"type": "string"},
                "highlights": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "detail": {"type": "string"},
                        },
                        "required": ["label", "detail"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["narrative", "highlights"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def generate_company_summary(facts: dict) -> dict:
    """facts: gather_company_context's return dict. Returns
    {"narrative": str, "highlights": [{"label", "detail"}]}.

    No try/except here, same reasoning as the other app/ai single-shot
    callers -- best-effort handling belongs to the caller (the
    company-summary router)."""
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(facts, ensure_ascii=False, default=str)},
    ]
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
        return json.loads(resp.choices[0].message.content)
    except Exception:
        logger.exception("Company summary generation failed")
        raise
```

- [ ] **Step 2: Write tests**

```python
import json

import app.ai.company_summary as mod


def test_generate_company_summary_parses_response(monkeypatch):
    class FakeMessage:
        content = json.dumps({
            "narrative": "Воронка растёт, но 4 справки ждут решения больше суток.",
            "highlights": [{"label": "4 справки ждут", "detail": "Дольше 24 часов без решения"}],
        })

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeCompletions:
        def create(self, **kwargs):
            assert kwargs["model"] == "gpt-4o"
            assert kwargs["response_format"] == mod._SCHEMA
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    result = mod.generate_company_summary({"leads_by_stage": {"matching": 3}})
    assert result["narrative"].startswith("Воронка растёт")
    assert result["highlights"][0]["label"] == "4 справки ждут"


def test_generate_company_summary_propagates_openai_failure(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            raise RuntimeError("boom")

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    monkeypatch.setattr(mod, "_get_client", lambda: FakeClient())
    try:
        mod.generate_company_summary({})
        assert False, "expected RuntimeError to propagate"
    except RuntimeError:
        pass
```

- [ ] **Step 3: Run tests**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_company_summary.py -v`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
cd backend
git add app/ai/company_summary.py tests/test_company_summary.py
git commit -m "feat: add company_summary AI module for the owner live summary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `POST /api/brain/company-summary` router + main.py registration

**Files:**
- Create: `backend/app/routers/company_summary.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the router**

```python
"""Argus Brain Phase 3: the boss's on-demand "Сводка" AI narrative. Unlike
Phase 2b's daily briefing, this is deliberately NOT cached -- one boss,
low click volume, debounced client-side against rapid re-clicks (see
docs/superpowers/specs/2026-08-05-argus-brain-design.md, "Owner live
summary"). Every POST here is a real OpenAI call.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.ai.brain import gather_company_context
from app.ai.company_summary import generate_company_summary
from app.db import get_service_client
from app.deps import require_boss

router = APIRouter(prefix="/api/brain")


@router.post("/company-summary")
def company_summary(user=Depends(require_boss)):
    client = get_service_client()
    facts = gather_company_context(client, user.tenant_id)
    try:
        return generate_company_summary(facts)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось построить сводку — попробуйте ещё раз")
```

- [ ] **Step 2: Register the router**

In `backend/app/main.py`, add `company_summary` to the existing import line (`app/main.py:11`):

```python
from app.routers import auth_google, units, leads, spravka, assistant, pricing, analytics, clients, conversations, payments, workspace, telegram_business, calendar, call_logs, ai_events, daily_briefing, company_summary
```

And add the registration line after `app.include_router(daily_briefing.router)` (`app/main.py:58`):

```python
app.include_router(company_summary.router)
```

- [ ] **Step 3: Manual smoke check**

Run: `cd backend && ./.venv/Scripts/python.exe -c "from app.main import app; print([r.path for r in app.routes if 'company-summary' in r.path])"`
Expected: `['/api/brain/company-summary']`

- [ ] **Step 4: Commit**

```bash
cd backend
git add app/routers/company_summary.py app/main.py
git commit -m "feat: expose POST /api/brain/company-summary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Frontend types + api.ts

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the type**

In `frontend/src/lib/types.ts`, near the existing `DailyBriefingItem` type, add:

```typescript
export type CompanySummary = {
  narrative: string;
  highlights: { label: string; detail: string }[];
};
```

- [ ] **Step 2: Add the API call**

In `frontend/src/lib/api.ts`, import `CompanySummary` alongside the existing `DailyBriefingItem` import at the top of the file, and add this entry to the `api` object right after `addMeetingNote`:

```typescript
  companySummary: (): Promise<CompanySummary> =>
    request("/api/brain/company-summary", { method: "POST" }),
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/lib/types.ts src/lib/api.ts
git commit -m "feat: add CompanySummary type and api.companySummary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: "Спросить AI" button + narrative render in `AssistantPanel.tsx`

**Files:**
- Modify: `frontend/src/components/AssistantPanel.tsx`

**Context:** The existing "Сводка" tab is rendered inside the `OverviewContent` function component (`frontend/src/components/AssistantPanel.tsx`, starting around line 218), specifically the `{tab === "summary" && digest && (...)}` block (around line 241). It currently shows three stat tiles + a per-building list. This task adds an AI narrative section below that block, inside the same `tab === "summary"` wrapper `<div>` (so it only renders when the Сводка tab is open) — a button that fetches `api.companySummary()` on click and displays the result.

- [ ] **Step 1: Add local state to `OverviewContent`**

Right after the function's prop destructuring (`frontend/src/components/AssistantPanel.tsx`, the `{ digest, isBoss, tab, onCloseTab, onOpenClient, onDecided }: {...}` block, right after its closing `)  {`), add:

```typescript
  const [companySummary, setCompanySummary] = useState<CompanySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  async function askAi() {
    setSummaryLoading(true);
    setSummaryError("");
    try {
      setCompanySummary(await api.companySummary());
    } catch (e: any) {
      setSummaryError(`Не удалось построить сводку: ${e.message}`);
    } finally {
      setSummaryLoading(false);
    }
  }
```

Add the needed imports at the top of `AssistantPanel.tsx`: `useState` is already imported (line 2); add `CompanySummary` to the existing `import { SpravkaRequest } from "@/lib/types";` line, making it `import { SpravkaRequest, CompanySummary } from "@/lib/types";`.

- [ ] **Step 2: Reset state when the tab closes**

Find `onCloseTab` — it's a prop passed down (the "Закрыть ✕" click handler at `frontend/src/components/AssistantPanel.tsx:236`). Don't modify the prop itself (it's owned by the parent `AssistantPanel`); instead reset local state on tab change by adding a `useEffect` right after the `askAi` function from Step 1:

```typescript
  useEffect(() => {
    if (tab !== "summary") {
      setCompanySummary(null);
      setSummaryError("");
    }
  }, [tab]);
```

(`useEffect` is already imported in this file — line 2.)

- [ ] **Step 3: Render the AI section**

Inside the existing `{tab === "summary" && digest && (<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>...</div>)}` block (`frontend/src/components/AssistantPanel.tsx:241-266`), add this as the LAST child, right after the closing `)}` of the `digest.buildingStats.length > 0` block and before the block's own closing `</div>`:

```tsx
              <div style={{ borderTop: "1px solid var(--color-hairline-soft)", paddingTop: 16 }}>
                {!companySummary && !summaryLoading && (
                  <button
                    onClick={askAi}
                    className="press"
                    style={{
                      fontSize: 12.5, fontWeight: 700, color: "#fff", background: "var(--v-accent)",
                      border: "none", borderRadius: 99, padding: "9px 18px", cursor: "pointer",
                    }}
                  >
                    Спросить AI
                  </button>
                )}
                {summaryLoading && (
                  <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Строю сводку…</div>
                )}
                {summaryError && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{summaryError}</div>
                    <button
                      onClick={askAi}
                      className="press"
                      style={{
                        fontSize: 12, fontWeight: 700, color: "var(--v-accent)", background: "none",
                        border: "1px solid var(--color-hairline)", borderRadius: 99, padding: "6px 14px",
                        cursor: "pointer", alignSelf: "flex-start",
                      }}
                    >
                      Повторить
                    </button>
                  </div>
                )}
                {companySummary && !summaryLoading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <p style={{ fontSize: 13, color: "var(--color-text-soft)", lineHeight: 1.6, margin: 0 }}>
                      {companySummary.narrative}
                    </p>
                    {companySummary.highlights.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {companySummary.highlights.map((h, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--v-accent)", flexShrink: 0, marginTop: 5 }} />
                            <div>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)" }}>{h.label}</div>
                              <div style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}>{h.detail}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={askAi}
                      className="press"
                      style={{
                        fontSize: 11.5, fontWeight: 700, color: "var(--color-text-faint)", background: "none",
                        border: "none", cursor: "pointer", alignSelf: "flex-start", padding: 0,
                      }}
                    >
                      Обновить сводку
                    </button>
                  </div>
                )}
              </div>
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/components/AssistantPanel.tsx
git commit -m "feat: add 'Спросить AI' owner live summary to Сводка tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Manual verification + push

**Files:** none (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q`
Expected: all tests pass (37 existing + 5 from Task 1 + 2 from Task 2 = 44).

- [ ] **Step 2: Run frontend production build**

Run: `cd frontend && npm run build`
Expected: `✓ Compiled successfully`, no type errors.

- [ ] **Step 3: Confirm no stray migrations needed**

This phase adds no new tables (the summary is deliberately uncached, per the design spec) — confirm with `git status` in `backend/supabase/migrations/` that no new migration files were accidentally created.

Run: `cd backend && git status --short supabase/migrations/`
Expected: empty output.

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Confirm Railway deploy**

Check both services (frontend + backend) deploy the pushed commit SHA with `SUCCESS` status before considering this phase done.
