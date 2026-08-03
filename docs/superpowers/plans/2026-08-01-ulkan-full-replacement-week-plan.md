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
- [x] ~~Does `payment_plan_rates` pricing logic survive the Payments-section removal?~~ — resolved 2026-08-02: yes, pricing stays. Only the due/paid/overdue tracking UI (`payments.py`) is cut, not the pricing lookup (`pricing.py`). See Day 1.
  - ~~Lead-distribution algorithm~~ — resolved 2026-08-02: simple even split between the two managers, no criteria. See Day 5.
  - Both Day 0 open questions now resolved.
- [ ] Lock Day 1's scope based on whether Macro access is ready.

## Day 1 — Sun Aug 2: Macro parity foundation
Everything downstream (Шахматка redesign, PDF export) needs a real baseline, so this goes first.
- [x] ~~If Macro access is granted, run a Claude Cowork audit~~ — **live access is blocked by the client's own privacy policy** (confirmed 2026-08-02 night), not just delayed. **Substitute found the same night:** client sent 2 real Macro PDF exports + 2 real screenshots (Заявки board, Шахматка grid). Full findings extracted into the vault page (`argus-full-replacement-requirements-2026-08.md`, section 1) — the real PDF is 4 pages, not 1; Шахматка/Заявки structure mostly already matches Argus, one missing status enum value found (Day 6 item).
- [x] Built the per-unit PDF export backend, twice tonight — first on the placeholder spec, then rebuilt once the real samples landed:
  - `backend/supabase/migrations/0020_tenant_users_phone.sql` — added `tenant_users.phone` (was missing entirely; needed for manager contact on the PDF).
  - `backend/supabase/migrations/0021_buildings_macro_parity_fields.sql` — added `buildings.address/landmark/completion_label/material/total_floors`, all nullable — fields the real PDF uses that the schema never had. Currently null for real buildings (not fabricated); the PDF renders each conditionally and omits it when absent.
  - `backend/app/services/unit_pdf_service.py` — page 1 (the unit info card) rebuilt field-for-field to match the real samples: manager+date header, project wordmark, title, two-column field grid, floor-plan image or placeholder. Pages 2-4 (full-floor plan, marketing copy, building renders) are explicitly deferred, not built — see the vault page for exactly why (asset-sourcing + schema gaps, not just time).
  - `GET /api/units/{unit_id}/pdf` in `backend/app/routers/units.py`, tenant-scoped, mirrors the `spravka.py` download-endpoint pattern.
  - Frontend: `api.unitPdfUrl()` in `frontend/src/lib/api.ts` + a "PDF юнита →" button in `UnitsPanel.tsx`'s unit detail panel.
  - Verified: both modules import cleanly, sample renders (full data + all-nulls) both produce valid `%PDF` output without crashing or fabricating missing fields.
  - **New open question found while reading the real PDFs:** does "Спецпредложение" (a second, lower price shown on some units — presumably `payment_plan_rates`-driven) need to appear on this general-purpose PDF, and against which plan_type, given there's no client/plan context here unlike a Справка? Left out of the rebuild — needs a client answer, not a guess.
  - **Bug caught by visual verification, fixed same night:** reportlab's built-in Helvetica/Helvetica-Bold have zero Cyrillic glyphs — every Russian label was rendering as a solid black box. Fixed by bundling DejaVu Sans (Bitstream Vera derivative, full Cyrillic coverage, freely redistributable — `backend/app/assets/fonts/DejaVuSans.ttf` + `-Bold.ttf` + `LICENSE.txt`) and registering it with reportlab in `unit_pdf_service.py`. Re-rendered the same Milano №38 sample as the real PDF side-by-side afterward to confirm — matches closely.
- [x] Resolve the payments-logic question from Day 0 concretely — **resolved 2026-08-02: pricing stays.** `payment_plan_rates` and its anchor/illusion mechanic keep driving real Справка pricing, unchanged. Only the Платежи section itself (due/paid/overdue installment tracking — `backend/app/routers/payments.py`, `payment_schedule` table) is being cut, per the original "banks won't provide the feed" reasoning.
  - Confirmed safe by code inspection the same day: `payment_plan_rates` already lives entirely separately in `backend/app/routers/pricing.py` (`/api/payment-plan-rates`), used only by `spravka_service.py` at Справка-creation time. `payments.py` is a different, unrelated table — the two were never coupled in code, only in the client's phrasing ("Платежи"). So deleting `payments.py` is a clean removal, no carve-out needed.
  - Remaining follow-up (unchanged from before, just re-scoped): `TodayQueue.tsx` calls `api.payments()` and needs rewiring once the section is actually removed — still a Day 5 item, now simpler since there's no pricing-logic entanglement to worry about.

## Day 2 — Mon Aug 3: Клиенты (client database)
- [x] Design + build the sorting/segmentation/filter overhaul for `ClientsPanel.tsx`:
  - Backend: `GET /api/clients` now also computes `buildings` (which buildings a client has touched via leads/spravki), `assigned_manager` (their most recent lead's manager), and `last_activity_at` (latest lead/spravka touch) per client — none of these existed before, all derived, nothing fabricated (`backend/app/routers/clients.py`, `_list_clients_with_stats` helper shared with the new AI endpoint below).
  - Frontend: filter bar (building/manager/priority dropdowns, reusing the existing `Dropdown` component) + a sort dropdown (по приоритету / по активности / по имени) added above the client grid in `ClientsPanel.tsx`. Manager tag now shows on each client card too.
  - **AI-assisted segmentation ("exceed Macro" half):** new `POST /api/clients/ai-segments` (`backend/app/ai/client_segmentation.py`, mirrors `telegram_evaluator.py`'s single-shot GPT-4o structured-output pattern) reasons over exactly the currently-filtered client list and returns 2-4 actionable segments (label + reason + client ids), filtered server-side against real ids so a hallucinated id can never reach the frontend. "✨ AI-сводка" button in `ClientsPanel.tsx` calls it; clicking a returned segment chip filters the list to just those clients.
  - **Verified end-to-end but not with a real result:** live-tested via dev server — the request reaches OpenAI and the error path works cleanly, but the account has no OpenAI credits (`insufficient_quota` / `credit_balance_exhausted`), so no real segments were seen live. Not a code bug — needs OpenAI billing topped up to actually see output.
  - **Bug caught by visual verification, fixed same session:** `useMemo` calls were placed after `ClientsPanel`'s loading early-return, violating Rules of Hooks ("Rendered more hooks than during the previous render", crashed the whole app once the client fetch resolved). Moved above the early return.
- [x] ~~Wire real filter criteria informed by the lead-distribution answer~~ — the lead-distribution answer (simple even split, no criteria) didn't give new client attributes to filter by; the real, useful attributes that emerged from actually querying the data were building/manager/priority/recency instead, which is what got built.

## Day 3 — Tue Aug 4: UI (client-facing + Мастерская split, part 1)
Both remaining items pulled forward and done 2026-08-03, same session as Day 2 — user wanted to cover two days at once.
- [x] ~~Add the 4th light theme~~ — **pulled forward and done 2026-08-02 night**, out of sequence, per the user's own call (client-facing UI felt more urgent to start than Day 2). `frontend/src/lib/theme.tsx` (`Theme` type + `THEME_LABELS`), `ThemeSwitcher.tsx` (swatch), `frontend/src/app/globals.css` (`:root[data-theme="light"]` block) — toggle, not a one-way replacement, staff keep their normal dark theme as default. Reuses the "teal" accent (darkened for white-background contrast) since that's already the client's real logo color, not a new invented brand color. Typechecked clean (`npx tsc --noEmit`).
  - **Known gap, not fixed tonight:** ~60 places across ~20 components hardcode `rgba(255,255,255,.0N)` as a dark-background-only "raised surface" tint (list-row hover states, subtle panel backgrounds, etc. — found via grep). These aren't wired to a CSS variable, so they'll look wrong or near-invisible once the light theme is actually selected. Needs a follow-up pass: introduce a `--surface-tint`-style variable and migrate call sites, or convert case-by-case. Not attempted tonight — flagged rather than silently left half-working.
  - **Visually verified 2026-08-02 night** (dev server + Playwright, dev-bypass login as the boss): the two main client-facing screens the theme was built for — Юниты grid and Клиенты list — hold up well in light mode, no invisible or broken elements. Confirmed the flagged gap empirically too: opening a unit's detail panel, the "Кто интересуется" (soft-leads) rows lose their card definition in light mode — text stays readable (dark-on-white), but the missing background tint flattens them into a plain list instead of boxed cards. Minor, matches what was predicted from the grep, not a blocker.
- [x] "Presentation mode" for Шахматка/unit views: new toggle button in `HudToolbar.tsx` (monitor icon, same active-state styling as the existing "Показать как…" button), state lives in `page.tsx`, threaded into `UnitsPanel.tsx` as a `presentationMode` prop. When on, hides Менеджер/Клиент and the entire "Кто интересуется" block (both in the unit list cards and the detail panel) — everything client-safe (unit facts, price, PDF export button) stays visible. Visually verified before/after via Playwright screenshot.
- [x] Start the Мастерская split: implement **flow (a)**, the fast auto-greeting message that fires immediately when a lead arrives. `backend/app/routers/telegram_business.py`'s webhook now sends a fixed (not AI-composed — that's flow (b), Day 5) greeting the moment a **brand-new** Telegram conversation's first real text message arrives. `_get_or_create_conversation` now returns `(conversation, is_new)`; `is_new` is the actual "lead just arrived" signal in this codebase's real shape, since there's no separate lead-creation endpoint this pilot uses — Telegram is the real arrival channel. Naturally idempotent (only fires once, when the conversation row is first inserted), wrapped best-effort so a failed send can't break message ingestion.

## Day 4 — Wed Aug 5: AI core (monitor function, part 1)
- [ ] Build the AI "monitor" over client conversations — parse incoming messages (e.g. "I'll come Wednesday") into a *proposed* structured action (e.g. draft calendar entry), surfaced for human confirm, following the справки/Telegram-draft pattern exactly.
- [ ] Stand up the new **Calendar section**: event feed UI + backend model, fed by confirmed monitor proposals (and manual entries).

## Day 5 — Thu Aug 6: AI continued + Telephony + lead distribution
- [ ] Мастерская split, **flow (b)**: the deeper "trained sales AI" ongoing-conversation flow, distinct from Tuesday's fast greeting.
- [ ] Telephony click-to-call: add a `tel:`-style protocol-link button next to phone numbers (confirmed by the client to be genuinely this simple — telephony itself is already fully set up on their end, no VoIP/PBX work needed).
- [ ] Implement lead auto-distribution: simple even split across the 2 managers (confirmed 2026-08-02) — no criteria/load-awareness needed.
- [ ] Extend pervasive AI reminders (call this lead, reply here, meeting at 2pm) by building on `TodayQueue.tsx` rather than a new component — this is literally what it already half-does. Rewire its `api.payments()` dependency per the Day 1 pricing-logic resolution.

## Day 6 — Fri Aug 7: Шахматка redesign + integration
- [ ] Full Шахматка redesign, grounded in the real screenshots from Day 1 (live audit never happened — access is blocked by the client's privacy policy). See vault page section 1 "Шахматка findings" for the extracted details.
- [ ] Add the missing `units.status` value: real Macro has a distinct "Маркетинговая сделка" status alongside `marketing_reserve`/`deal_completed` that Argus's enum doesn't have yet (found 2026-08-02 from the real Шахматка screenshot). Needs a migration touching the `status` check constraint plus every place that lists/colors statuses (`STATUS_LABELS`/`STATUS_COLORS` in `frontend/src/lib/types.ts`).
- [ ] Wire the per-unit PDF export button into the redesigned chess-grid (endpoint already built Day 1 — see `backend/app/routers/units.py`).
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
