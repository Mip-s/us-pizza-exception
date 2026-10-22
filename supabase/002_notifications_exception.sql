-- 22/10: the hub's notification centre only allowed uptime/review/maintenance/grn, so the Exception Agent's entries
-- were rejected. Applied to the project 22/10.
alter table public.notifications drop constraint notifications_module_check;
alter table public.notifications add constraint notifications_module_check
  check (module = any (array['uptime', 'review', 'maintenance', 'grn', 'exception']));

-- 22/10: "Ignore" on the board's unmatched-name picker = an alias with no outlet (that report name is never checked).
alter table exception_agent.outlet_aliases alter column outlet_id drop not null;
