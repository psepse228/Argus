"""Generates and maintains brain_items -- the live, actionable half of
Argus Brain (ai_events, see app/routers/ai_events.py, is the passive
permanent log; this is what Brain currently wants a manager to act on).

Two kinds of candidates feed this:
1. Deterministic facts from gather_manager_context (leads, calendar events,
   справки) -- GPT judges which of them deserve a live item, citing the
   source record's id so we get a stable identity (dedupe_key), not just
   phrased text. Same "never invent a fact" discipline as daily_briefing.py.
2. Existing ai_events rows (coaching_tip, event_proposed) with outcome
   still null -- these already carry their own summary and identity, no
   GPT re-judgment needed, just promotion into the same live queue.

sync_brain_items() diffs candidates against existing brain_items rows on
(tenant_id, assigned_to, kind, dedupe_key): a dismissed/snoozed/done row is
left untouched (a decision, once made, doesn't get silently undone by
tomorrow's regeneration); an open row whose candidate disappeared gets
auto-resolved; everything else is upserted.
"""
import json
import logging
import os
from datetime import datetime, timedelta, timezone

from openai import OpenAI

from app.ai.brain import gather_manager_context

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


_SYSTEM_PROMPT = """Ты решаешь, какие факты о работе менеджера по продажам недвижимости
заслуживают отдельной активной задачи в очереди Argus Brain. На входе -- JSON с его лидами,
календарными событиями, справками и звонками (то же самое, что видит "На сегодня").

Правила, какие факты превращать в задачу:
- Лид в стадии "reserved" без движения больше 3 дней -- kind="stale_lead", priority="high".
- Лид без первого контакта дольше 24 часов, или с последним звонком no_answer -- kind="stale_lead",
  priority="normal".
- Событие из events_missing_notes (прошедшая встреча без заметки) -- kind="missing_note",
  priority="normal".
- Справка (pending_spravki) висит на согласовании больше 2 дней -- kind="pending_spravka_aging",
  priority="high" если больше 4 дней, иначе "normal".
- Если факт не подходит ни под одно из правил -- не создавай для него задачу.

Для каждой задачи укажи:
- kind: один из "stale_lead", "missing_note", "pending_spravka_aging"
- ref_table: "leads" для stale_lead, "calendar_events" для missing_note, "spravka_requests"
  для pending_spravka_aging
- ref_id: id того самого объекта из входных данных (лида/события/справки) -- ОБЯЗАТЕЛЬНО должен
  быть одним из id, реально присутствующих во входном JSON, никогда не выдумывай.
- client_id: client_id этого объекта, если есть в данных, иначе null.
- summary: короткая формулировка задачи (например "Позвонить +998911110002")
- detail: почему, одна фраза (например "Резерв висит 4 дня без движения")

Никогда не выдумывай факт, которого нет во входных данных. Если срочных задач нет, верни
пустой список items."""

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "brain_item_candidates",
        "schema": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["stale_lead", "missing_note", "pending_spravka_aging"]},
                            "ref_table": {"type": "string", "enum": ["leads", "calendar_events", "spravka_requests"]},
                            "ref_id": {"type": "string"},
                            "client_id": {"type": ["string", "null"]},
                            "summary": {"type": "string"},
                            "detail": {"type": "string"},
                            "priority": {"type": "string", "enum": ["high", "normal"]},
                        },
                        "required": ["kind", "ref_table", "ref_id", "client_id", "summary", "detail", "priority"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["items"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def _valid_ids(facts: dict) -> dict:
    """{"leads": {id, ...}, "calendar_events": {id, ...}, "spravka_requests": {id, ...}} --
    used to reject a hallucinated ref_id before it ever becomes a dedupe_key."""
    return {
        "leads": {l["id"] for l in facts.get("leads", [])},
        "calendar_events": {e["id"] for e in facts.get("calendar_events", [])},
        "spravka_requests": {s["id"] for s in facts.get("pending_spravki", [])},
    }


_GPT_PASS_THROTTLE = timedelta(minutes=3)


def _get_tenant_user_row(client, tenant_id: str, email: str) -> dict | None:
    rows = (
        client.table("tenant_users").select("id, brain_synced_at")
        .eq("tenant_id", tenant_id).eq("email", email)
        .execute().data
    )
    return rows[0] if rows else None


def _should_run_gpt_pass(tenant_user_row: dict | None) -> bool:
    """Guards the one expensive part of a sync (the gpt-4o call below) --
    the deterministic candidate sources stay live on every call regardless,
    they're plain DB reads. Without this, nothing stops repeated calls to
    GET /api/brain-items (a second tab, a fast re-navigation, a future
    caller without the frontend's own dedup cache) from each firing a fresh
    GPT call; a stale/missing timestamp always runs it (first sync ever, or
    the throttle window has passed)."""
    if tenant_user_row is None or not tenant_user_row.get("brain_synced_at"):
        return True
    last = datetime.fromisoformat(tenant_user_row["brain_synced_at"].replace("Z", "+00:00"))
    return datetime.now(timezone.utc) - last >= _GPT_PASS_THROTTLE


def _generate_candidates(facts: dict) -> list[dict]:
    """One GPT call, judgment same discipline as daily_briefing.py. Filters
    out any item whose ref_id isn't actually present in the input facts --
    defensive against a hallucinated id turning into a bogus dedupe_key."""
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(facts, ensure_ascii=False, default=str)},
    ]
    client = _get_client()
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=messages, response_format=_SCHEMA)
        items = json.loads(resp.choices[0].message.content)["items"]
    except Exception:
        logger.exception("Brain item candidate generation failed")
        return []
    valid = _valid_ids(facts)
    out = []
    for it in items:
        if it["ref_id"] not in valid.get(it["ref_table"], set()):
            logger.warning("Dropping brain item candidate with unknown ref_id %s/%s", it["ref_table"], it["ref_id"])
            continue
        out.append(it)
    return out


def _promoted_ai_event_candidates(client, tenant_id: str, manager_email: str) -> list[dict]:
    """coaching_tip/event_proposed ai_events rows still undecided (outcome
    is null), from the last 7 days -- promoted as-is, no GPT re-judgment,
    they already carry their own summary and identity."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    rows = (
        client.table("ai_events").select("*")
        .eq("tenant_id", tenant_id).eq("manager_email", manager_email)
        .in_("kind", ["coaching_tip", "event_proposed"])
        .is_("outcome", "null")
        .gte("created_at", cutoff)
        .execute().data
    )
    return [
        {
            "kind": r["kind"], "ref_table": "ai_events", "ref_id": r["id"],
            "client_id": r.get("client_id"), "summary": r["summary"], "detail": None,
            "priority": "high" if r["kind"] == "event_proposed" else "normal",
        }
        for r in rows
    ]


def _unconfirmed_event_candidates(facts: dict) -> list[dict]:
    """Deterministic, no GPT judgment needed -- an AI-proposed calendar
    event still sitting at status='proposed' unambiguously needs the
    manager's confirm/decline. Same list Calendar's own "Требуют
    подтверждения" section shows, with NO age cutoff (unlike the 7-day
    window on promoted ai_events above) -- an old unconfirmed meeting is
    exactly as urgent as a new one, and Calendar itself never hides one for
    being old."""
    out = []
    for e in facts.get("calendar_events", []):
        if e.get("status") != "proposed":
            continue
        when_label = e.get("event_at", "")
        try:
            dt = datetime.fromisoformat(when_label.replace("Z", "+00:00"))
            when_label = dt.strftime("%d.%m %H:%M")
        except (ValueError, AttributeError):
            pass
        client_info = e.get("clients") or {}
        who = client_info.get("name") or client_info.get("phone")
        out.append({
            "kind": "unconfirmed_event", "ref_table": "calendar_events", "ref_id": e["id"],
            "client_id": e.get("client_id"),
            "summary": f"Подтвердить встречу — {who}" if who else "Подтвердить встречу",
            "detail": when_label or None,
            "priority": "high",
        })
    return out


def _upsert_and_resolve(client, tenant_id: str, assigned_to: str, candidates: list[dict]) -> list[dict]:
    """Shared diff-and-upsert core behind every sync_*_brain_items function:
    upserts each candidate unless an existing row for the same (kind,
    dedupe_key) has already been decided (dismissed/snoozed/done), auto-
    resolves any open row whose candidate disappeared, returns the
    resulting open items, priority-then-recency sorted."""
    seen_keys: set[tuple[str, str]] = set()
    for c in candidates:
        dedupe_key = f"{c['ref_table']}:{c['ref_id']}"
        seen_keys.add((c["kind"], dedupe_key))
        existing = (
            client.table("brain_items").select("id, status")
            .eq("tenant_id", tenant_id).eq("assigned_to", assigned_to)
            .eq("kind", c["kind"]).eq("dedupe_key", dedupe_key)
            .execute().data
        )
        if existing and existing[0]["status"] != "open":
            continue  # dismissed/snoozed/done -- a decision, leave it alone
        payload = {
            "tenant_id": tenant_id, "assigned_to": assigned_to, "kind": c["kind"],
            "dedupe_key": dedupe_key, "client_id": c["client_id"],
            "summary": c["summary"], "detail": c["detail"], "priority": c["priority"],
        }
        if existing:
            client.table("brain_items").update(payload).eq("id", existing[0]["id"]).execute()
        else:
            client.table("brain_items").insert({**payload, "status": "open"}).execute()

    open_rows = (
        client.table("brain_items").select("id, kind, dedupe_key")
        .eq("tenant_id", tenant_id).eq("assigned_to", assigned_to).eq("status", "open")
        .execute().data
    )
    now = datetime.now(timezone.utc).isoformat()
    for row in open_rows:
        if (row["kind"], row["dedupe_key"]) not in seen_keys:
            client.table("brain_items").update({"status": "done", "resolved_at": now}).eq("id", row["id"]).execute()

    return (
        client.table("brain_items").select("*, clients(name, phone)")
        .eq("tenant_id", tenant_id).eq("assigned_to", assigned_to).eq("status", "open")
        .order("priority").order("created_at")
        .execute().data
    )


def sync_brain_items(client, tenant_id: str, manager_email: str) -> list[dict]:
    """Diffs current candidates against existing brain_items rows and
    returns this manager's open items, priority-then-recency sorted. The
    GPT pass (_generate_candidates) is throttled per manager -- see
    _should_run_gpt_pass; the deterministic sources below it always run."""
    facts = gather_manager_context(client, tenant_id, manager_email)
    tenant_user_row = _get_tenant_user_row(client, tenant_id, manager_email)
    candidates = []
    if _should_run_gpt_pass(tenant_user_row):
        candidates += _generate_candidates(facts)
        if tenant_user_row is not None:
            client.table("tenant_users").update(
                {"brain_synced_at": datetime.now(timezone.utc).isoformat()}
            ).eq("id", tenant_user_row["id"]).execute()
    candidates += _promoted_ai_event_candidates(client, tenant_id, manager_email)
    candidates += _unconfirmed_event_candidates(facts)
    return _upsert_and_resolve(client, tenant_id, manager_email, candidates)


def sync_boss_brain_items(client, tenant_id: str, boss_email: str) -> list[dict]:
    """Deterministic, boss-only candidates -- no GPT judgment needed, a
    pending справка unambiguously needs the boss's decision regardless of
    how long it's been sitting. Distinct from pending_spravka_aging above,
    which nudges the REQUESTING manager to follow up only after 2+ days --
    this covers every pending справка tenant-wide, immediately, for the
    person who actually approves them."""
    pending = (
        client.table("spravka_requests")
        .select("id, client_id, units(unit_number, buildings(name))")
        .eq("tenant_id", tenant_id).eq("status", "pending")
        .execute().data
    )
    candidates = []
    for s in pending:
        unit = s.get("units") or {}
        unit_label = f"№{unit['unit_number']}" if unit.get("unit_number") else None
        building = (unit.get("buildings") or {}).get("name")
        candidates.append({
            "kind": "pending_spravka_approval", "ref_table": "spravka_requests", "ref_id": s["id"],
            "client_id": s.get("client_id"),
            "summary": f"Одобрить справку — {unit_label}" if unit_label else "Одобрить справку",
            "detail": building,
            "priority": "high",
        })
    return _upsert_and_resolve(client, tenant_id, boss_email, candidates)
