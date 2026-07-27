-- Lets a rep type in a specific price/m² they want to request for a client
-- (e.g. a special deal), instead of always using the fixed payment_plan_rates
-- lookup. Stored so the boss sees exactly what was requested during review;
-- when set, it's also what actually gets used as the real price in the
-- generated Справка (see spravka_service.py::create_spravka).
alter table public.spravka_requests add column requested_price_per_m2_usd numeric(10,2);
