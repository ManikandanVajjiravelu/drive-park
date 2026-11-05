-- "Find my car": the driver saves their own reminder of where the car is parked
-- (level, pillar, gate). Written only by arrival.server.ts (service role) so a client
-- can never forge one through a direct UPDATE; hosts read it from the booking row.
alter table public.reservations
  add column if not exists parking_notes text;

comment on column public.reservations.parking_notes is
  'Driver saved locator for Find My Car, e.g. "Level B2, Pillar 14". Set via saveParkingNoteFn.';

-- Same ceiling as PARKING_NOTE_MAX in src/lib/arrival-window.ts: the rule lives in the
-- database too, so a future caller cannot store an essay or a blank string.
alter table public.reservations
  drop constraint if exists reservations_parking_notes_len;
alter table public.reservations
  add constraint reservations_parking_notes_len
  check (parking_notes is null or char_length(parking_notes) between 1 and 120);
