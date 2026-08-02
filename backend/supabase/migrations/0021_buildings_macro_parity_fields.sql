-- Fields the real Macro per-unit PDF shows that buildings never had (found by
-- reading two real Macro PDF exports the client provided 2026-08-02, since
-- live macroserver.uz access is blocked by their privacy policy). Nullable --
-- render only what's actually filled in, never fabricate address/material/etc.
alter table public.buildings add column address text;               -- "Яшнабадский район, ул. Садык Азимова, 1 проезд, д. 15."
alter table public.buildings add column landmark text;               -- "ориентир: японское посольство, ц-1"
alter table public.buildings add column completion_label text;       -- "IV квартал 2025 года" -- free text, not a strict date
alter table public.buildings add column material text;               -- "Монолит"
alter table public.buildings add column total_floors int;            -- этажность
