-- Real Macro CRM unit numbers include suffixes (50A, 1A, 6A...) — not pure ints.
alter table public.units alter column unit_number type text using unit_number::text;
