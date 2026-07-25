-- Persists the computed numbers (effective price/m2, monthly payment,
-- down payment, total, payment label) alongside each spravka_request, so
-- the dashboard can show an inline preview without ever needing to parse
-- the generated .xlsx file. JSONB rather than individual numeric columns
-- since calc.py's SpravkaResult fields are expected to keep evolving
-- (e.g. balloon-specific fields already differ per plan type).
alter table public.spravka_requests add column if not exists computed_summary jsonb;
