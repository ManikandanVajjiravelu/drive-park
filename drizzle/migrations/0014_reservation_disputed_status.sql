-- "Can't Park" rescue, part 1 of 2: a new reservation state.
-- Postgres refuses to *use* an enum value in the transaction that adds it (55P04), and
-- SQL function bodies are validated at CREATE time, so the value is added here on its own
-- and used in 0015_arrival_issues.sql.
alter type public.reservation_status add value if not exists 'disputed';

comment on type public.reservation_status is
  'upcoming -> active -> completed; cancelled before start; disputed while a driver issue is open.';
