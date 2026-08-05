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

from datetime import datetime, timezone


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


def gather_manager_context(client, tenant_id: str, manager_email: str) -> dict:
    """Deterministic fact set behind one manager's daily briefing (Phase 2b):
    their leads, calendar events tied to their clients, справки they've
    requested that are still pending, their recent call outcomes, and any
    past confirmed meeting that still needs a note. Pure data assembly, no
    AI, no judgment -- app/ai/daily_briefing.py does the prioritization and
    phrasing on top of this.

    leads.assigned_manager and spravka_requests.requested_by both store a
    NAME (matching tenant_users.name), not the login email used everywhere
    else in Argus Brain (ai_events, call_logs, telegram_business_connections
    all key by email) -- resolve through tenant_users first rather than
    assuming they're the same identifier.
    """
    user_row = (
        client.table("tenant_users").select("name")
        .eq("tenant_id", tenant_id).eq("email", manager_email).execute().data
    )
    if not user_row:
        return {
            "manager_name": None, "leads": [], "calendar_events": [],
            "events_missing_notes": [], "pending_spravki": [], "recent_calls": [],
        }
    manager_name = user_row[0]["name"]

    leads = (
        client.table("leads").select("*")
        .eq("tenant_id", tenant_id).eq("assigned_manager", manager_name).execute().data
    )
    client_ids = {l["client_id"] for l in leads if l.get("client_id")}

    all_events = (
        client.table("calendar_events").select("*, clients(name, phone)")
        .eq("tenant_id", tenant_id).neq("status", "dismissed").execute().data
    )
    manager_events = [e for e in all_events if e.get("client_id") in client_ids]

    notes = client.table("meeting_notes").select("calendar_event_id").eq("tenant_id", tenant_id).execute().data
    noted_event_ids = {n["calendar_event_id"] for n in notes}
    now_iso = datetime.now(timezone.utc).isoformat()
    events_missing_notes = [
        e for e in manager_events
        if e["status"] == "confirmed" and e["event_at"] < now_iso and e["id"] not in noted_event_ids
    ]

    pending_spravki = (
        client.table("spravka_requests")
        .select("*, units(unit_number, buildings(name))")
        .eq("tenant_id", tenant_id).eq("requested_by", manager_name).eq("status", "pending").execute().data
    )

    recent_calls = (
        client.table("call_logs").select("*")
        .eq("tenant_id", tenant_id).eq("logged_by", manager_email)
        .order("created_at", desc=True).limit(20).execute().data
    )

    return {
        "manager_name": manager_name,
        "leads": leads,
        "calendar_events": manager_events,
        "events_missing_notes": events_missing_notes,
        "pending_spravki": pending_spravki,
        "recent_calls": recent_calls,
    }
