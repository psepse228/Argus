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
