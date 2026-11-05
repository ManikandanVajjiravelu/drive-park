-- Arrival tracking stores a timestamp only: the driver's coordinates were never needed
-- ("I am here" is a single tap, not a location check), so stop collecting and storing
-- them. Drops the coordinate columns added by 0012.
alter table public.reservations
  drop column if exists arrived_lat,
  drop column if exists arrived_lng;