"""Журнал AI (ai_events) -- an append-only log written to AFTER an existing
AI call-site has already produced its result. No new OpenAI calls happen
here; this is pure logging, addressing the transparency gap in Argus Brain
(see docs/superpowers/specs/2026-08-06-ai-events-journal-design.md) -- a
manager being "directed" by the AI with no visible track record doesn't
build trust. Every call here is meant to be wrapped best-effort by its
caller: a failure to log must never break the real feature that already
happened (matches this codebase's established convention, e.g. the
auto-greeting/event-proposal code in telegram_business.py).
"""


def log_ai_event(
    client, tenant_id: str, kind: str, summary: str,
    client_id: str | None = None, manager_email: str | None = None,
    related_id: str | None = None,
) -> None:
    client.table("ai_events").insert({
        "tenant_id": tenant_id, "kind": kind, "summary": summary,
        "client_id": client_id, "manager_email": manager_email, "related_id": related_id,
    }).execute()


def mark_event_outcome(client, tenant_id: str, related_id: str, outcome: str) -> None:
    """Best-effort -- a missing journal row (e.g. a manually-created calendar
    event that was never an AI proposal) is not an error, just a no-op."""
    client.table("ai_events").update({"outcome": outcome}).eq("tenant_id", tenant_id).eq("related_id", related_id).execute()
