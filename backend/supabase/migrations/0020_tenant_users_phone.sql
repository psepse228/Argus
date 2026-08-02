-- Manager contact info for the per-unit PDF export (Macro parity, see
-- docs/superpowers/plans/2026-08-01-ulkan-full-replacement-week-plan.md Day 1).
-- units.assigned_manager is a free-text name with no FK, so the PDF service
-- looks this up by name match at generation time, not a join.
alter table public.tenant_users add column phone text;
