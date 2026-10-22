-- 22/10: discount spikes and void spikes (applied to the project 22/10).
create table exception_agent.daily_voids (
  outlet_id      uuid not null references public.outlets (outlet_id) on delete cascade,
  business_date  date not null,
  net            numeric not null,
  gross          numeric,
  bills          int,
  report_name    text,
  batch_id       bigint references exception_agent.import_batches (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (outlet_id, business_date)
);
alter table exception_agent.daily_voids enable row level security;
grant all on exception_agent.daily_voids to service_role;

alter table exception_agent.import_batches add column kind text not null default 'sales' check (kind in ('sales', 'voids'));

alter table exception_agent.exceptions drop constraint exceptions_kind_check;
alter table exception_agent.exceptions add constraint exceptions_kind_check
  check (kind in ('sales_drop', 'no_sales', 'discount_spike', 'void_spike'));
alter table exception_agent.exceptions
  add column value  numeric,   -- discount_spike: discount % of gross that day · void_spike: RM voided that day
  add column usual  numeric,   -- the outlet's usual (median of its last 28 days) of the same measure
  add column impact numeric;   -- RM at stake: sales below expected / extra discount / voids above usual (ranking)
update exception_agent.exceptions set impact = greatest(coalesce(expected, 0) - coalesce(net_sales, 0), 0);
