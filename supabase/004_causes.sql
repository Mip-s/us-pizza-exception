-- 22/10: possible causes (AI) for each exception — outlet locations (weather), promotions calendar, causes on exceptions.
create table exception_agent.outlet_geo (
  outlet_id  uuid primary key references public.outlets (outlet_id) on delete cascade,
  lat        numeric not null,
  lon        numeric not null
);
insert into exception_agent.outlet_geo (outlet_id, lat, lon)
select o.outlet_id, v.lat, v.lon
  from (values
    ('001', 3.112, 101.595),
    ('002', 3.157, 101.718),
    ('003', 3.023, 101.702),
    ('004', 3.074, 101.591),
    ('005', 3.101, 101.618),
    ('006', 3.052, 101.583),
    ('007', 3.155, 101.697),
    ('008', 3.146, 101.714),
    ('009', 2.828, 101.710),
    ('010', 2.250, 102.303),
    ('011', 2.199, 102.238),
    ('012', 2.700, 101.913),
    ('013', 2.695, 101.995),
    ('014', 1.846, 102.951),
    ('015', 1.545, 103.758),
    ('016', 1.562, 103.620),
    ('017', 1.562, 103.620),
    ('018', 4.613, 101.118),
    ('019', 5.887, 116.088),
    ('020', 5.367, 100.306),
    ('021', 5.329, 100.269),
    ('022', 5.426, 100.383),
    ('023', 5.340, 100.479),
    ('024', 5.265, 100.481),
    ('025', 5.452, 100.307),
    ('026', 3.102, 101.445),
    ('027', 5.630, 100.513),
    ('028', 3.060, 101.685),
    ('029', 6.006, 116.116),
    ('030', 2.922, 101.649),
    ('031', 3.184, 101.519),
    ('032', 3.112, 101.595),
    ('033', 3.074, 101.591),
    ('034', 2.833, 101.532),
    ('035', 4.904, 100.718),
    ('036', 3.045, 101.622),
    ('037', 5.376, 100.407),
    ('038', 1.846, 102.951),
    ('039', 2.833, 101.532),
    ('040', 3.210, 101.640),
    ('041', 3.316, 101.560),
    ('042', 5.379, 100.534),
    ('051', 3.071, 101.740),
    ('068', 5.398, 100.287),
    ('069', 3.235, 101.431),
    ('070', 2.954, 101.781),
    ('071', 3.235, 101.676),
    ('075', 3.162, 101.613),
    ('076', 1.537, 110.358),
    ('078', 5.329, 100.269),
    ('079', 3.202, 101.726),
    ('081', 3.155, 101.589),
    ('082', 3.191, 101.626),
    ('083', 3.193, 101.688),
    ('SG-001', 1.375, 103.850),
    ('SG-002', 1.332, 103.914),
    ('SG-003', 1.304, 103.766),
    ('SG-004', 1.339, 103.871),
    ('SG-005', 1.332, 103.859),
    ('SG-009', 1.386, 103.745)
  ) v (code, lat, lon)
  join public.outlets o on o.code = v.code
on conflict (outlet_id) do update set lat = excluded.lat, lon = excluded.lon;

-- US Pizza promotions (and notable competitor ones) that move sales or discounts; entered by operations on the board
create table exception_agent.promotions (
  id          bigserial primary key,
  name        text not null,
  source      text not null default 'us_pizza' check (source in ('us_pizza', 'competitor', 'other')),
  starts      date not null,
  ends        date not null,
  regions     text[] not null default '{}',   -- empty = every region
  outlet_ids  uuid[] not null default '{}',   -- empty = every outlet in those regions
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  check (ends >= starts)
);
insert into exception_agent.promotions (name, source, starts, ends, note, created_by) values
  ('Pizza Hut 10.10 Deals (RM10 pizzas & sides, RM10 off)', 'competitor', '2026-10-01', '2026-10-20', 'everydayonsales.com', 'seed');

alter table exception_agent.exceptions
  add column causes     jsonb,         -- [{ cause, likelihood: high|medium|low, evidence, check }], from the AI
  add column cause_tag  text,          -- a few words for the push / badge (the top cause)
  add column context    jsonb,         -- the facts the AI was given (calendar, weather, promos, other outlets, ...)
  add column causes_at  timestamptz;

alter table exception_agent.outlet_geo enable row level security;
alter table exception_agent.promotions enable row level security;
grant all on exception_agent.outlet_geo, exception_agent.promotions to service_role;
grant all on all sequences in schema exception_agent to service_role;

-- 22/10 (later): the causes in Malay / Chinese / Burmese, translated from the English ones by Workers AI
alter table exception_agent.exceptions add column causes_i18n jsonb; -- { ms|zh|my: { tag, causes: [{cause, evidence, check}] } }

-- 22/10 (later still): AI "possible causes" removed (not good enough). Promotions calendar kept.
alter table exception_agent.exceptions drop column if exists causes, drop column if exists cause_tag, drop column if exists context,
  drop column if exists causes_at, drop column if exists causes_i18n;
drop table if exists exception_agent.outlet_geo;
