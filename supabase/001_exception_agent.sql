-- Exception Agent (21/10): daily outlet sales from the Codemax/FeedMe "Sales Summary Listing" (uploaded by operations
-- on the board) and the exceptions found in them (sales far below what Chronos-2 expected for that outlet and day).
-- Only the Worker (service key) reads and writes these tables; the board goes through the Worker's /api, which scopes
-- every answer to the signed-in person's outlets. Schema must be listed under Data API -> Exposed schemas.

create schema if not exists exception_agent;
grant usage on schema exception_agent to service_role;

create table exception_agent.import_batches (
  id           bigserial primary key,
  file_name    text,
  date_from    date,
  date_to      date,
  row_count    int,
  outlets      int,
  imported_by  text,
  imported_at  timestamptz not null default now(),
  unmatched    text[] not null default '{}',   -- outlet names in the file that match no hub outlet
  skipped      text[] not null default '{}'    -- matched, but not checked (franchise / MFM / not monitored)
);

create table exception_agent.daily_sales (
  outlet_id      uuid not null references public.outlets (outlet_id) on delete cascade,
  business_date  date not null,
  gross          numeric,
  discount       numeric,
  net            numeric not null,
  bills          int,
  guests         int,
  report_name    text,
  batch_id       bigint references exception_agent.import_batches (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (outlet_id, business_date)
);

-- The report's outlet codes are not the hub's (report 002 = Kota Warisan, hub 002 = Ampang) and some names differ:
-- name key (lower case, letters + digits, without the code and "US Pizza") -> outlet. Learnt automatically when a
-- name matches; the ones below were checked by hand on the September 2026 report.
create table exception_agent.outlet_aliases (
  name_key    text primary key,
  outlet_id   uuid not null references public.outlets (outlet_id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table exception_agent.exceptions (
  id               bigserial primary key,
  outlet_id        uuid not null references public.outlets (outlet_id) on delete cascade,
  business_date    date not null,
  kind             text not null check (kind in ('sales_drop', 'no_sales')),
  net_sales        numeric,
  expected         numeric,
  usual_low        numeric,
  usual_high       numeric,
  pct_of_expected  int,
  bills            int,
  method           text,                -- chronos2 | baseline
  same_day         int not null default 0, -- other outlets flagged on the same day (a common cause: rain, system, holiday)
  status           text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  notified_at      timestamptz,
  resolved_at      timestamptz,
  resolved_by      uuid,
  unique (outlet_id, business_date, kind)
);
create index exceptions_open on exception_agent.exceptions (status, business_date desc);

alter table exception_agent.import_batches enable row level security;
alter table exception_agent.daily_sales enable row level security;
alter table exception_agent.outlet_aliases enable row level security;
alter table exception_agent.exceptions enable row level security;

grant all on all tables in schema exception_agent to service_role;
grant all on all sequences in schema exception_agent to service_role;

insert into exception_agent.outlet_aliases (name_key, outlet_id)
select a.k, o.outlet_id
  from (values
    ('austin', '015'), ('rawang', '041'), ('kulimkedah', '042'), ('lucerncesquarepenang', '078'),
    ('hextarempirecity', '075'), ('lsh33sentul', '083'), ('kuchingvivacity', '076')
  ) a (k, code)
  join public.outlets o on o.code = a.code
on conflict (name_key) do nothing;
