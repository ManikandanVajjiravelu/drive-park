alter table public.reservations
  add column if not exists arrived_at timestamptz,
  add column if not exists late_notified_at timestamptz;
create index if not exists idx_reservations_arrived on public.reservations (arrived_at) where arrived_at is not null;
comment on column public.reservations.arrived_at is 'Driver pressed I am here';
comment on column public.reservations.late_notified_at is 'Driver pressed Running late';

create table if not exists public.arrival_issues (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  driver_id uuid not null,
  issue_type text not null check (issue_type in ('spot_occupied','gate_locked','wrong_address','other')),
  note text check (note is null or char_length(note) <= 280),
  status text not null default 'pending' check (status in ('pending','resolved','rejected')),
  resolution_deadline timestamptz not null default now() + interval '15 minutes',
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz not null default now()
);
create unique index if not exists arrival_issues_one_pending on public.arrival_issues (reservation_id) where status = 'pending';
create index if not exists arrival_issues_reservation_idx on public.arrival_issues (reservation_id, created_at desc);
create index if not exists arrival_issues_driver_idx on public.arrival_issues (driver_id, created_at desc);

grant select on public.arrival_issues to authenticated;
grant all on public.arrival_issues to service_role;
alter table public.arrival_issues enable row level security;

drop policy if exists arrival_issues_select_driver on public.arrival_issues;
create policy arrival_issues_select_driver on public.arrival_issues for select to authenticated
  using (driver_id = auth.uid());
drop policy if exists arrival_issues_select_owner on public.arrival_issues;
create policy arrival_issues_select_owner on public.arrival_issues for select to authenticated
  using (exists (select 1 from public.reservations r join public.slots s on s.id = r.slot_id
    where r.id = arrival_issues.reservation_id and s.owner_id = auth.uid()));
drop policy if exists arrival_issues_select_admin on public.arrival_issues;
create policy arrival_issues_select_admin on public.arrival_issues for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.guard_arrival_issue_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  if not public.is_privileged() then
    raise exception 'Issues must be reported through the booking service';
  end if;
  if not exists (select 1 from public.reservations r where r.id = new.reservation_id and r.driver_id = new.driver_id) then
    raise exception 'Issue does not match its reservation';
  end if;
  return new;
end $$;
drop trigger if exists guard_arrival_issue_insert_trg on public.arrival_issues;
create trigger guard_arrival_issue_insert_trg before insert on public.arrival_issues
for each row execute function public.guard_arrival_issue_insert();

create or replace function public.get_slots_private(_slot_ids uuid[])
returns table(slot_id uuid, full_address text, access_instructions text, lat double precision, lng double precision)
language sql stable security definer set search_path = public
as $$
  select s.id, s.full_address, s.access_instructions, s.lat, s.lng from public.slots s
  where s.id = any(_slot_ids) and (
    s.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin') or exists (
      select 1 from public.reservations r
      where r.slot_id = s.id and r.driver_id = auth.uid()
        and r.status in ('upcoming','active','disputed','completed')
        and r.payment_expires_at is null
        and public.reservation_balance(r.id) >= 0))
$$;

create or replace function public.advance_reservations()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_active int := 0; n_done int := 0; n_warn int := 0; n_note int := 0;
begin
  with up as (
    update reservations r set status = 'active'
     where r.status = 'upcoming' and r.start_time <= now() and r.end_time > now()
       and reservation_balance(r.id) >= 0
    returning r.id)
  select count(*) into n_active from up;

  with done as (
    update reservations r set status = 'completed'
     where r.status in ('upcoming','active','disputed') and r.end_time <= now()
       and reservation_balance(r.id) >= 0
       and not (r.pending_extension is not null
                and coalesce((r.pending_extension->>'expires_at')::timestamptz, 'infinity') > now())
    returning r.id, r.driver_id, r.slot_id),
  ins as (
    insert into notifications (user_id, type, title, body, link)
    select d.driver_id, 'booking_completed', 'Parking completed',
           'Your booking at ' || s.name || ' is complete. Leave a review?', '/reservations?r=' || d.id
      from done d join slots s on s.id = d.slot_id
     where not exists (select 1 from notifications x where x.type = 'booking_completed' and x.link = '/reservations?r=' || d.id)
    union all
    select s.owner_id, 'booking_completed_host', 'Booking completed',
           'A booking at ' || s.name || ' has finished.', '/bookings?r=' || d.id
      from done d join slots s on s.id = d.slot_id
     where not exists (select 1 from notifications x where x.type = 'booking_completed_host' and x.link = '/bookings?r=' || d.id)
    returning 1)
  select (select count(*) from done), (select count(*) from ins) into n_done, n_note;

  with w as (
    insert into notifications (user_id, type, title, body, link)
    select r.driver_id, 'booking_ending', 'Your parking ends in 15 minutes',
           'Extend from My Reservations if you need more time.', '/reservations?r=' || r.id
      from reservations r
     where r.status = 'active' and r.end_time > now() and r.end_time <= now() + interval '15 minutes'
       and reservation_balance(r.id) >= 0
       and not exists (select 1 from notifications x where x.type = 'booking_ending' and x.link = '/reservations?r=' || r.id)
    returning 1)
  select count(*) into n_warn from w;

  return jsonb_build_object('activated', n_active, 'completed', n_done, 'ending_soon', n_warn, 'completion_notices', n_note);
end $$;
revoke execute on function public.advance_reservations() from public, anon, authenticated;
grant execute on function public.advance_reservations() to service_role;

create or replace function public.slot_open_booking_count(_slot_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.reservations where slot_id = _slot_id and status in ('upcoming','active','disputed')
$$;
revoke execute on function public.slot_open_booking_count(uuid) from public, anon;
grant execute on function public.slot_open_booking_count(uuid) to authenticated, service_role;

alter table public.reservations add column if not exists parking_notes text;
comment on column public.reservations.parking_notes is 'Driver saved locator for Find My Car, e.g. "Level B2, Pillar 14".';
alter table public.reservations drop constraint if exists reservations_parking_notes_len;
alter table public.reservations add constraint reservations_parking_notes_len
  check (parking_notes is null or char_length(parking_notes) between 1 and 120);