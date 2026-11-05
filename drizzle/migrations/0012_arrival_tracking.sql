alter table public.reservations
  add column if not exists arrived_at timestamptz,
  add column if not exists arrived_lat double precision,
  add column if not exists arrived_lng double precision,
  add column if not exists late_notified_at timestamptz;

create index if not exists idx_reservations_arrived
  on public.reservations (arrived_at)
  where arrived_at is not null;

comment on column public.reservations.arrived_at is 'Driver pressed I am here';
comment on column public.reservations.late_notified_at is 'Driver pressed Running late';