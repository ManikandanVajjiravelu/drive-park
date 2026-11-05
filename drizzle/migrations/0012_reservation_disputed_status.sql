alter type public.reservation_status add value if not exists 'disputed';
comment on type public.reservation_status is
  'upcoming -> active -> completed; cancelled before start; disputed while a driver issue is open.';