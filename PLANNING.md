# Argus — Sales Ops Platform (planning)

**Naming convention (matches Cortège/Sarbon):** the product is always **Argus** in conversation and any client-facing material. **Ulkan Development** is the pilot client, not the product name — same relationship as "Cortège ≠ Sarbon." Named after the Greek all-seeing, hundred-eyed giant, picked specifically for the boss-oversight angle (nothing slips through unapproved).

Pilot candidate #3, alongside Tender Agent and Cortège. Meeting target: ~6-7 days from 2026-07-23 (a Wednesday, exact date TBD). Owner's instruction: build the real thing, don't artificially cut scope to fit the date — the meeting is a checkpoint to show real progress, not a hard ceiling.

## Structure (from owner, ex-employee, real insider knowledge)

- One company, **5 buildings** (mini-projects) under it — not 5 separate client tenants like Tender Agent/Cortège's model. Data model: tenant (Ulkan) → buildings → units.
- Lead flow: Facebook ads → sales rep calls → books meeting. Not a DM-driven concierge like Cortège — the AI's job is helping the *sales team*, not answering cold buyers.
- Existing tools: "Macro" CRM (sales team's daily tool, don't replace) + Telegram for client communication. No confirmed API for Macro as of this note — **do not depend on Macro integration for v1**, build our own Supabase backend.

## 4 starter features (owner's real priority list)

1. **Boss's assistant ("mini-madina")** — every sale needs boss approval before confirming; this assistant answers pipeline/status questions and is the approval side of #3.
2. **Sales-manager assistant** — kills the 20-30min manual "send company info + планировки + chat" step after a rep finds an interested lead. Highest-certainty ROI, most concretely scoped.
3. **Pricing/negotiation-bounds assistant** — reps quote an anchor price (e.g. 2500k/m²) then stall on "I'll ask my boss" for the real number. Give reps AI-visible bounds for common cases; escalate the rest to the boss's assistant for fast approval instead of the current delay.
4. **Excel generator (запрос / реестр)** — reps currently hand-build these documents every time they request a sale approval. Needs real sample templates (incoming from owner) — do not guess the format.

## Explicitly rejected

- **Lead pre-filtering/scoring to auto-drop leads** — owner vetoed this. A wrongly-dropped lead has real monetary cost with no human safety net, unlike Tender Agent's advisory (never-deletes) scoring. If lead scoring happens at all later, it must be advisory only, never a silent filter.

## Two-role dashboard

- **Boss view (Madina)** — monitor everything: uploads, confirmations, pipeline, approval queue.
- **Sales agent view** — day-to-day tool: leads, info-send, price requests, Excel generation.

## Data source for the demo

Owner has personal access to Ulkan's real leads + планировки data (own old CRM account) — **company has explicitly authorized this for product development.** Guardrails: read-only against the real CRM (never write/modify live data), and be careful with real client PII ending up anywhere beyond this build (demo screenshots, wiki notes, etc.).

## Real assets received (2026-07-23) — `Argus/Files/`

**Project identity:** the actual project is called **Italiano Vero** — 5 buildings named after Italian cities: **Milano** (nearly complete, first building), **Roma** (construction starting now), **Neapol**, **Venice**, **Florencia**. Logo: teal/dark-cyan (`#0e4a52`-ish), elegant serif ("ITALIANO VERO", an "I"-column mark). Real render (`Milano/AF_UTAC_2306014_Cam*.jpg`): modern residential tower, ground-floor retail, balconies, greenery accents.

**Real floor plans** (`Milano/Планировки/*.jpg`, note: source filenames are mojibake-corrupted Cyrillic, read by exact path not by eye): format is `Этаж: N / Подъезд: N / Квартира № N / [room type] / S=XX.XX м²`, room-by-room breakdown (e.g. Студия 29.85м² + Санузел 4.8м² + Балкон 3.0м²), plus a small building-position minimap. **Roma has no real floor plans yet** — owner copied Milano's plans into the Roma folder as stand-ins; Roma unit data in the demo is understood to be fabricated/adjusted for beta-testing, not real Roma pricing — do not present it to Ulkan as accurate.

**Real CRM screenshots** (`Screenshots of crm/`) — CRM is **Macro** (`macroserver.uz`), confirms the real data model directly:
- **Lead pipeline stages** (`Заявки` board): Неразобранное → Подбор → Встреча назначена → Встреча проведена → Бронь → Платная бронь. Each lead card: call source, phone, "Buy: apartment, city X", assigned manager, timestamp, ticket ID.
- **Unit inventory grid** (`ЖК Milano` → "Шахматка"/chess view): every unit as a color-coded card by status (green=Продаётся/for sale, orange=Бронь, purple=Платная бронь, red=Сделка проведена/маркетинговый резерв, grey=Маркетинговый резерв) — shows unit №, room-count badge, price ($), area (м²), price/м², assigned manager, and on click: floor, room type, level count, ceiling height, client name+phone (if sold/reserved), floor-plan thumbnail, manager. URL pattern: `macroserver.uz/account/groupestate/chess/{object_id}/`.

**Real Excel "справка" (quote) template** (`Excel samples/*.xlsx`, parsed with openpyxl) — confirms the exact formula/structure needed for the Excel generator feature:
- Header: `Справка по {Building} {Client Name} {Phone}`
- Per-unit row: №, этаж, квадратура, price/м² without promo ($ + сум), total without promo ($ + сум), total WITH акция discount ($ + сум, 0 if no discount), **effective/final** price/м² and total ($ + сум) used for the payment plan below
- Payment: `Оплата` = either `"100% Оплата"` or `"рассрочка на N"` (N = 9/12/24 months seen); down-payment % baked into the column header text itself per file (`Перво-начальный взнос (сум)30%` vs `...50%` vs `...40%` — **the generator must dynamically produce this label, not just the number**), remaining balance, monthly payment amount, total paid over the term
- Footer: `курс по таблицу` (daily exchange rate — genuinely varies file-to-file: 12070, 12260, 12000 seen), `Менеджер` name
- **`последний Task.xlsx` is the most current/complex variant** ("последний" = "latest") — adds a partial-then-balloon structure: N months of a smaller payment, then a large remaining balance due after (`Остаток после N месяцев оплат`) — a real hybrid schedule (small payments during construction, balloon near handover), not just linear amortization. Build the generator to support this as the general case, with straight amortization as the simple case.

## Supabase project (decided 2026-07-23)

Reusing `pfmzciaijhqxzqcljvsx` (personal Supabase account — Solura's own account already has Tender Agent + Cortège, hitting the 2-projects-per-account cap). This project was shared/repurposed: confirmed via the real PostgREST API before touching anything that it held old Cortège-era tables (tenants, company_profile, messages, conversations, client_profiles, escalations, availability_cache, reviews, broadcasts, knowledge_gaps, cortege_leads — all safe, Cortège now runs on its own dedicated `ckkbvkajimlrcxuccfxj` project) **and** a `leads` table (40 rows) matching the Lead Generation system's real Chattanooga TN cold-calling batch. Owner confirmed 2026-07-23 that Lead Generation work is stopped and this is safe to lose. Migration `backend/supabase/migrations/0001_init_schema.sql` drops all old tables and creates Argus's schema (tenants → buildings → units, leads matching Macro's real pipeline stages, pricing_rules for negotiation bounds, spravka_requests for the boss-approval workflow); `0002_seed_ulkan.sql` seeds Ulkan Development + the real 5 buildings (Milano nearly_complete, Roma/Neapol/Venice/Florencia construction). **Owner needs to run both files in the Supabase SQL Editor** — no DB password available for a direct connection, only the service_role API key (row-level access, not DDL).

## Real Milano data seeded (2026-07-23)

131 real units inserted into `units` via `seed_milano.py` (transcribed directly from the real Macro CRM chess-grid screenshots — both Подъезд 1 (13 floors) and Подъезд 2 (15 floors)). Verified against the real CRM popup: unit №50, entrance 1 → floor 11, 80.60m², $2538/m², status `deal_completed`, client "Smirnov Igor Ar" — matches exactly.

**Status color→value mapping is inferred, not confirmed** (best-effort for beta purposes): white/plain→`for_sale`, red→`deal_completed`, green+"Ulkan Development" label→`marketing_reserve`, blue→`deal_in_progress`, orange/pink→`reserved`. The 🔥 fire icon seen on some cards was treated as a decorative "hot" tag, not a real status, and ignored. **Worth confirming this mapping with the owner before the demo is presented as authoritative.**

**Roma: 22 placeholder units seeded (`seed_roma.py`), deliberately small** — not a full building like Milano's 131 real units, since Roma just started construction and has no real chess-grid data yet. Mostly `for_sale` status (realistic for a building this early — Milano's mostly-sold-out inventory reflects it being nearly complete, Roma shouldn't look the same). Pricing ballparked off the one real Roma sample (`100 % roma.xlsx`, $1500/m² base) with light variation by room type/floor. **Explicitly fabricated/beta data — rebuild entirely once real Roma access exists, do not treat as real Ulkan pricing.**

## Backend built and verified end-to-end (2026-07-23)

FastAPI backend (`backend/app/`) — Google OAuth login ported from Cortège's `session.ts`/Tender Agent's `session.py` (same HMAC token format, `DEV_BYPASS_EMAIL` local-dev shortcut), extended with a `role` field neither existing product needed. **Deliberate divergence from the playbook:** `tenant_users` rows are NOT auto-created on first login like Cortège/Tender Agent's self-serve pattern — roles are a real permission distinction here, provisioned ahead of time (migration `0004`), not something a new Google login should be able to grant itself.

Verified live, end to end, against the real Supabase project:
- Login → session cookie encodes email/tenant/role correctly
- `/api/units/buildings` → 5 real buildings, tenant-scoped
- `/api/units` → 153 units (131 real Milano + 22 placeholder Roma)
- `/api/spravka-requests`: a 2% discount (within the 5% bound) auto-approved and generated a real Excel file; a 15% discount (over bound) correctly queued `pending`; boss-approval endpoint then generated the file and marked it `approved`
- Generated file spot-checked directly with openpyxl: correct dynamic "30%" down-payment label, discount correctly applied to price/m², correct рассрочка math, correct exchange rate pulled from `pricing_rules`

All watched for the FastAPI async/blocking-I/O gotcha from the start (every Supabase-touching handler kept as plain `def`, not `async def`) — not caught after the fact this time.

## Pricing model corrected (2026-07-23) — real business logic, not what was first assumed

The owner revealed the chess-grid price (e.g. $2578/m²) is a deliberate **anchor/illusion price** — the real price is a **fixed table lookup per payment-plan type** (cash / 6 / 12 / 24-month), not a rep-negotiated discount%. This replaced the earlier `pricing_rules.max_discount_pct` bounds-check model entirely:

- New table `payment_plan_rates` (migration `0006`): real price/m² per building × plan type. Milano seeded with the 2 real numbers given (6mo=$1850, 24mo=$1950) — **12mo ($1900) and cash ($2578) are placeholders pending real figures, clearly flagged, not to be trusted for the demo as-is.**
- Workflow corrected to **review-after, not approve-before**: a rep picks a plan, the system looks up the real rate, generates the Справка immediately, logs it to `spravka_requests` (status starts `pending` = awaiting boss review, not blocking generation), boss confirms/rejects afterward via the dashboard.
- Boss's assistant given a real **write** capability (`set_payment_plan_rate`) — deliberately boss-only, never exposed to the sales-agent assistant's tool list, same access-control reasoning as tenant_users not self-serve-provisioning roles.

**Verified live, end to end:** created a request on the 24-month plan against a real $2578-anchor unit → correctly used $1950 (not $2578) in the generated file (spot-checked directly in the .xlsx — anchor in column D, real price in column J, matching exactly). Boss set a new rate via natural-language chat ("поставь для Milano 6 месяцев 1800") → verified it persisted by asking a fresh chat query afterward, not just trusting the "ok" response.

**Two real bugs caught by live-testing this**, not by inspection — matching the established Solura pattern (mocked tests verify plumbing, only real live-model tests catch judgment/data bugs):
1. `get_units`'s room_type filter used an exact-match Supabase `.eq()` — GPT called it with a different casing than what was stored ("студия" vs "Студия"), silently returned 0 rows, and the model correctly-but-misleadingly reported "none available" for a room type with 31 real matches. Fixed with case/punctuation-normalized Python-side filtering.
2. The 131 real Milano units never got a `room_type` value during the original seed (only the Roma placeholders did) — backfilled via an area-based heuristic (documented as inferred, not real Macro badges) since re-transcribing exact room-count badges from the screenshots wasn't worth the time against the deadline.

## Real frontend built and verified live (2026-07-23)

Next.js app in `frontend/`, conversation-first (per owner's "assistant brain tool, not another CRM" direction) — porting the structure/logic validated in the claude.ai/design interactive prototype, but wired to the real backend (real GPT-4o assistant calls, real Excel generation, real auth) instead of the prototype's canned regex replies and CSV download.

Five real sections: **Ассистент** (chat, primary landing view), **Юниты** (all 153 real units, filterable by building), **Лиды** (stage-based columns, empty until real Facebook-lead data is loaded), **Справки** (the owner's explicit ask — a dedicated generation form + real history/approve/reject, not just a chat artifact), **Аналитика** (boss-only, richer than a shallow approve-list: real KPIs, unit-status breakdown, and the real payment-plan-rates table).

**A real bug found and fixed during this build:** the backend's post-login redirect pointed to `/boss` or `/agent` on its own origin — a leftover from before the frontend existed as a separate app. Fixed to redirect to the actual frontend (`FRONTEND_URL` env var, defaults to `localhost:3000/app`).

**Verified live via Playwright, not just "should work":** logged in via `DEV_BYPASS_EMAIL`, screenshotted all 5 sections with real data loaded, sent a real chat message and got a real GPT-4o response, confirmed the Справки section shows the actual 5 test records created earlier in this session with correct status chips.

**Known gaps as of this entry (2026-07-23 EOD) — both since closed, see the 2026-07-24 entries below:**
- ~~Generated Справка files live in server-local temp directories (`tempfile.mkdtemp()`) — they do NOT survive a backend restart.~~ Fixed 2026-07-24, see "Generated files migrated to Supabase Storage."
- ~~Excel generator's visual formatting not yet applied to the writer.~~ Fixed 2026-07-24, see "Excel visual formatting applied."
- Cash and 12-month payment-plan rates are still placeholders (cash = anchor price, 12mo = interpolated) — only 6mo ($1850) and 24mo ($1950) are real numbers from the owner.
- Leads table is genuinely empty — real Facebook-lead data was never loaded, only Macro CRM screenshots were used for the units/chess-grid model.

## Still needed

- [ ] Exact meeting date (still just "~6-7 days from Wed 2026-07-23")
- [ ] Real Roma floor plans/pricing (not available yet — Milano stand-ins used for beta, clearly flagged as such)

## Build sequence (once inputs land)

1. Supabase schema (tenant → buildings → units, leads, pricing rules, approval requests)
2. Excel generator (deterministic, no AI, lowest risk — build and prove this first)
3. Two-role dashboard shell with real seeded data
4. Pricing/negotiation-bounds + boss-approval flow
5. Sales-manager info-dump assistant + boss's assistant (most iteration needed, sequenced last)

## Status as of end of day 2026-07-23 — everything above is real and verified live

Backend + frontend are both functionally complete and tested against the real Supabase project via Playwright (login → all 5 sections → real chat → real Справка generation → real analytics). Not deployed anywhere yet — running locally only (`backend` on :8010, `frontend` on :3000). GitHub repo `https://github.com/psepse228/Argus` was given but never pushed to.

## Methodology decision (2026-07-23 EOD): switching to the rigorous approach going forward

Owner's call after discussing the trade-off directly: today's direct-build-and-live-test approach was necessary while requirements were still changing mid-session (the pricing model flipped entirely once the anchor/illusion-price mechanic came out), but it means Argus has **no independent review pass** behind it, unlike Tender Agent/Cortège — only sample-based live-testing, not systematic code-quality review. Real risk: latent bugs in paths nobody happened to test today (Leads stage-updates, the balloon-payment Excel writer path, etc.).

**Decision: from here on, use the full Tender Agent/Cortège process** (brainstorming → written spec → written plan → subagent-driven-development, two-stage review: spec-compliance then code-quality) **even though it costs more tokens** — owner explicitly prioritized quality over speed now that requirements have stabilized (the core data model and pricing logic are settled, this isn't still-changing-mid-build territory anymore).

## Multi-day plan from here

**Day 1 (next session) — "first look" finish, done properly:**
1. Run an actual code-quality review pass over everything built today (not a rebuild) — the review step Tender Agent/Cortège got and this didn't. Priority: paths never live-tested (Leads stage-updates, balloon-payment Excel path, the frontend's error states).
2. Excel visual formatting fix — real style fingerprint already captured (fonts, borders, column widths, number formats) in a scratch file, not yet applied to `backend/app/excel_gen/writer.py`. Owner explicit this must be visually identical to a human-made file, not just numerically equivalent.
3. Migrate generated files to Supabase Storage (currently server-local temp dirs, don't survive a restart).

**Day 2+ — stress testing, security testing, general hardening** (owner's explicit phrasing): matching the same rigor Tender Agent/Cortège got in their own hardening passes (see [[projects/solura/concepts/fundraising-plan]] in the wiki for what that looked like on the other two products — adversarial live-eval AI testing, a real security audit, infra root-causing). Specifics TBD at that session, but likely includes:
- Adversarial live-eval tests on both AI assistants (matching Tender Agent's pattern — domain-mismatch cases, prompt injection, the boss-only `set_payment_plan_rate` tool never reachable from the agent role)
- Security review: tenant-scoping on every endpoint, the boss-only role check, session token handling
- Real numbers still needed: cash/12-month payment-plan rates, real Roma data, exact meeting date, status-color→value mapping confirmation

**Not yet done, deliberately paused:** push to GitHub (`github.com/psepse228/Argus`) and deploy to Railway — hold until the above review pass is done, not before, per owner's instruction to build for quality now.

## Code-quality review pass — done (2026-07-24), 4 real findings fixed and verified

Ran directly against the local files (the `review` skill assumes a GitHub PR diff, but Argus has no git repo yet — did a manual pass on the flagged priority areas instead). All 4 fixed and re-verified live, not just patched and assumed:

1. **`leads.py` `update_lead_stage` silently no-opped instead of 404ing** on a bad/foreign lead id — Supabase's `.update()` returns 200 with an empty list when the filter matches nothing, and the frontend's optimistic UI update would show a stage change that never happened in the DB. Fixed: raises 404 when `res.data` is empty. Verified: `PATCH .../00000000.../stage` now correctly returns 404.
2. **`_write_balloon`'s two "итого" column headers hardcoded "12 месяцев"** regardless of the real `balloon_months` value, inconsistent with every other dynamic label in the same function. Fixed to interpolate. Verified: a real balloon request with `balloon_months=9` now produces a file whose headers correctly read "9 месяцев", not "12".
3. **The balloon plan was completely unreachable from the real product** — `SpravkaRequestCreate` had no `balloon_months`/`balloon_monthly_payment_usd` fields, so despite `_write_balloon` existing and being correct(able), no sales agent could ever actually generate one through the app — only a standalone test script could. Fixed: added the fields to the request model + a checkbox/two-field UI in the Справки form ("Частичная оплата с остатком"), gated behind an explicit checkbox since it's the less common case. Verified: a real API call with balloon fields now succeeds and generates the correct file.
4. **Both `LeadsPanel.move()` and `DocsPanel.act()` had no try/catch** — any backend failure (including the 404 now added in #1) would surface as a silent unhandled promise rejection with zero user feedback. Fixed: both now show a visible error message on failure.

Backend + frontend both restarted and re-tested live after each fix, not just assumed correct from the diff.

## Excel visual formatting applied (2026-07-24) — Day 1 item #2, done

The real style fingerprint (`styles.py`) was already captured from the actual sample files; `writer.py` now applies it cell-by-cell instead of writing plain unstyled values — column widths, row heights, zoom, title/header/data fonts (the real files' Times New Roman + Arial + a "last column" Calibri split across specific columns), medium/thin border boxing, and per-column number formats (`0.00` for money, `0%` for the down-payment percentage, `mm-dd-yy` for the balloon start date). The balloon layout keeps its own distinct all-thin-border look, matching what the real `последний Task.xlsx` sample actually does (not assumed identical to the other two layouts).

Verified by generating a real file and reading it back with openpyxl: title font/border at A2 (Times New Roman 14 bold, medium box), header row fonts correctly split by column group, data row fonts/number-formats correct, footer rows populated. Numeric correctness re-confirmed unaffected (monthly payment math still correct on a 24-month test case).

## Generated files migrated to Supabase Storage (2026-07-24) — Day 1 item #3, done

Replaced the server-local `tempfile.mkdtemp()` dirs (didn't survive a backend restart) with a private `spravka-files` bucket. New `app/storage.py`: `upload_spravka()`/`download_spravka()`, bucket auto-created on first use if missing (`list_buckets`/`create_bucket` via the service-role key, `public: false`). `spravka.py`'s `_generate_and_store` still writes to a local temp path first (openpyxl needs a real path to save to) but now uploads it to storage and discards the temp dir immediately after, storing the storage path (not a disk path) in `generated_file_url`. The download endpoint no longer reads from disk — it fetches bytes from storage and streams them back through a plain `Response`, gated by the same tenant-ownership check as before. The bucket itself is private; that endpoint's tenant check is the only thing standing between a request and the file, never a public URL.

Verified live end-to-end through the real running API (not just the storage functions in isolation): logged in via `DEV_BYPASS_EMAIL`, created a real spravka request through `POST /api/spravka-requests`, confirmed `generated_file_url` came back as a storage path (`{tenant_id}/{request_id}.xlsx`), downloaded it through `GET /api/spravka-requests/{id}/download`, and confirmed the downloaded file's title/fonts/dynamic down-payment label were all correct — proving the storage round-trip doesn't corrupt the styled output. Test request + storage object cleaned up afterward.

## Pushed to GitHub + deployed to Railway (2026-07-24)

**GitHub:** initialized the repo (none existed before), added a root `.gitignore` (venvs, node_modules, `.env`, and `Files/` — the real client assets: real Excel samples with real client names, real CRM screenshots — kept out of version control entirely per the PII guardrail). Pushed to `github.com/psepse228/Argus` on `main`.

**Railway:** project `airy-success` (id `a61b2fb6-921c-4499-bc3b-e8d9659a66ed`), two services:
- `Argus` (backend) — live at `https://argus-production-cc37.up.railway.app`
- `frontend` — live at `https://frontend-production-c423.up.railway.app`

Both deployed via CLI upload (`railway up`) rather than GitHub auto-deploy — Railway's Railpack builder couldn't auto-detect either app from a monorepo subdirectory without an explicit root directory and start command, and the MCP tool's `update_service` (which would normally set those) was broken all session (`list_services`/`get_logs`/`update_service` all failed with "Failed to get project" across every project tested, not just this one — a real bug in the connector, not a transient auth issue; `list_projects`/`create_project` worked fine throughout). Worked around it with `backend/railway.json` and `frontend/railway.json` config-as-code files (`deploy.startCommand`) committed to the repo, so the start command survives future redeploys without needing that broken tool.

Backend env vars set: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, a freshly-generated production `SESSION_SECRET` (not the `...-not-for-production` dev one), `ENVIRONMENT=production` (confirmed this correctly disables the `DEV_BYPASS_EMAIL` login shortcut in prod — hitting `/api/auth/google/start` now correctly returns `"Google OAuth is not configured on the server"` instead of silently bypassing auth), `FRONTEND_URL` pointing at the real frontend domain. `main.py`'s CORS was hardcoded to `localhost:3000` — fixed to read `FRONTEND_URL` from env, verified with a real preflight request showing `access-control-allow-origin` correctly matching the production frontend origin.

**Known gap, not yet closed:** `GOOGLE_OAUTH_CLIENT_ID`/`SECRET`/`REDIRECT_URI` are still empty — no real Google login works in production yet (matches Tender Agent/Cortège's playbook, just not wired up for Argus yet). Needs real Google Cloud OAuth credentials before anyone but the (now-disabled-in-prod) dev bypass can log in.
