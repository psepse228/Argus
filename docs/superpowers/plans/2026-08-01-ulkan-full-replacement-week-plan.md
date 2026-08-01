# Ulkan Full CRM Replacement — Week Plan (2026-08-01 → 2026-08-09)

> **Context:** the 2026-07-31 client meeting with Ulkan Development went very well — they spoke for most of it describing what they want, which reads as full buy-in on replacing their Macro CRM (`macroserver.uz`) with Argus entirely, not just extending the pilot. Full raw requirements + provenance live in the Solura Brain vault at `projects/solura/concepts/argus-full-replacement-requirements-2026-08.md` — read that first if picking this up cold. This doc is the *sequencing*; the vault page is the *why*.
>
> **This is a living plan, not a locked spec.** Update it as work happens — check off days, add discoveries, re-sequence if something blocks. It's committed to the repo specifically so it survives across local *and* cloud Claude Code sessions (unlike `~/.claude/` memory, which is scoped per starting directory, and unlike the Obsidian vault, which cloud sessions can't see at all).

## Ground rules carried into every day below
- FastAPI handlers touching Supabase: plain `def`, never `async def`.
- Every query manually tenant-scoped — no RLS reliance.
- Any AI-driven write (calendar entries from parsed messages, lead distribution, reminders) is **propose-then-confirm**, same trust pattern already used for справки and Telegram draft replies. Nothing here gets silent autonomy.
- Prefer extending what already exists over rebuilding: `TodayQueue.tsx` is already a proto "ideal day" briefing; `ThemeSwitcher.tsx`/`theme.ts` already has the plumbing for a 4th (light) theme option; don't restart these from scratch.

---

## Day 0 — Sat Aug 1 (this evening, kickoff)
Not a build day — a grounding/scoping session before the real week starts.
- [ ] Confirm current status of Macro CRM access (has the client actually granted it yet?). This gates Day 1.
- [ ] Walk the full requirements list together (vault page) and confirm nothing was missed from the brief.
- [ ] Answer or explicitly defer the two open questions:
  1. Does `payment_plan_rates` pricing logic survive the Payments-section removal, or is pricing tracking being cut too?
  2. Lead-distribution algorithm: round-robin, or criteria-based (and on what criteria)?
- [ ] Lock Day 1's scope based on whether Macro access is ready.

## Day 1 — Sun Aug 2: Macro parity foundation
Everything downstream (Шахматка redesign, PDF export) needs a real baseline, so this goes first.
- [ ] **If Macro access is granted:** run a Claude Cowork audit against `macroserver.uz`'s real Шахматка and PDF-export flow. Capture: exact fields on the chess-grid, exact PDF layout/contents, any other Macro feature not yet accounted for in the requirements list.
- [ ] **If Macro access is NOT yet granted:** don't block the whole day — start the per-unit PDF export backend work using the already-known spec (floor plan image + building/unit info + manager contact) as a placeholder layout, flag it for a visual pass once real Macro PDFs are seen.
- [ ] Resolve the payments-logic question from Day 0 concretely: if pricing stays, carve `payment_plan_rates` access out of `backend/app/routers/payments.py` before deleting the rest of that router, rather than deleting the whole file.

## Day 2 — Mon Aug 3: Клиенты (client database)
- [ ] Design + build the sorting/segmentation/filter overhaul for `ClientsPanel.tsx` — match Macro's own clarity (client's stated bar), then exceed it with AI-assisted segmentation.
- [ ] Wire real filter criteria informed by whatever the lead-distribution answer from Day 0 turned out to be, if it's ready in time (the two features share client attributes).

## Day 3 — Tue Aug 4: UI (client-facing + Мастерская split, part 1)
- [ ] Add the 4th light theme to `frontend/src/lib/theme.ts` + `ThemeSwitcher.tsx` (toggle, not a one-way replacement — staff keep their normal working theme).
- [ ] Build a "presentation mode" for the chess-grid / unit views that hides internal-only fields when a client is looking at the screen.
- [ ] Start the Мастерская split: implement **flow (a)**, the fast auto-greeting message that fires immediately when a lead arrives — this is the smaller, more self-contained half of the split.

## Day 4 — Wed Aug 5: AI core (monitor function, part 1)
- [ ] Build the AI "monitor" over client conversations — parse incoming messages (e.g. "I'll come Wednesday") into a *proposed* structured action (e.g. draft calendar entry), surfaced for human confirm, following the справки/Telegram-draft pattern exactly.
- [ ] Stand up the new **Calendar section**: event feed UI + backend model, fed by confirmed monitor proposals (and manual entries).

## Day 5 — Thu Aug 6: AI continued + Telephony + lead distribution
- [ ] Мастерская split, **flow (b)**: the deeper "trained sales AI" ongoing-conversation flow, distinct from Tuesday's fast greeting.
- [ ] Telephony click-to-call: add a `tel:`-style protocol-link button next to phone numbers (confirmed by the client to be genuinely this simple — telephony itself is already fully set up on their end, no VoIP/PBX work needed).
- [ ] Implement lead auto-distribution using whatever algorithm was settled on Day 0 (round-robin as the fallback default if the client never specifies criteria).
- [ ] Extend pervasive AI reminders (call this lead, reply here, meeting at 2pm) by building on `TodayQueue.tsx` rather than a new component — this is literally what it already half-does. Rewire its `api.payments()` dependency per the Day 1 pricing-logic resolution.

## Day 6 — Fri Aug 7: Шахматка redesign + integration
- [ ] Full Шахматка redesign, now grounded in the Day 1 Macro audit (or the placeholder-then-revisit path if access came late).
- [ ] Wire the per-unit PDF export button into the redesigned chess-grid.
- [ ] Integration pass: walk every new surface (Calendar, monitor proposals, TodayQueue reminders, lead distribution, click-to-call, light theme) end-to-end as one connected story, not isolated features.

## Day 7 — Sat Aug 8: Testing & stress-testing
- [ ] Live-test with realistic volume assumptions (40 leads/day, 2 managers) rather than the ~5-demo-client scale the original build was verified against.
- [ ] Adversarial pass on the AI monitor/confirm flows — try to get it to over-trigger or mis-parse, confirm nothing writes without a human confirm click.
- [ ] Re-verify tenant scoping on every new/changed query touched this week (new Calendar tables, lead-distribution logic, any payments-router split).

## Day 8 — Sun Aug 9: Polish
- [ ] Visual pass across all new/changed screens — this is a client-facing product now, both staff and walk-in clients will see it.
- [ ] Update `PLANNING.md` and the vault requirements page with anything that changed from plan to reality during the week.
- [ ] Decide next steps: deploy timing, whether a Cowork audit pass (like Cortège's pre-launch one) is warranted before going live with the full replacement.

---

## Explicitly deferred / not in this week
- Deep telephony (this stayed a click-to-call button, not a PBX integration, per the client's own clarification).
- Anything the two open questions from Day 0 don't get answered on — don't guess past what the client actually said; surface as a real open question in the next client conversation instead.
