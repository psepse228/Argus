-- Real installment payment tracking, not just a one-time price quote.
--
-- A Справка already computes a full payment plan (down payment, monthly
-- installment, optional balloon remainder) and shows it once at generation
-- time -- but nothing tracked what happened after: which months the client
-- actually paid, which are overdue. This is that missing piece, modeled on
-- how loan-servicing software represents an amortization schedule (balance,
-- next payment due, overdue flag), generated once a Справка is approved
-- (the point at which the deal becomes real, not just a quote).

create table public.payment_schedule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  spravka_request_id uuid not null references public.spravka_requests(id) on delete cascade,
  installment_number int not null,   -- 0 = down payment, 1..N = regular/balloon installments, last = lump remainder
  label text not null,               -- "Первый взнос", "Платёж 3/12", "Остаток"
  due_date date not null,
  amount_usd numeric(12,2) not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (spravka_request_id, installment_number)
);

create index on public.payment_schedule (tenant_id, status, due_date);
