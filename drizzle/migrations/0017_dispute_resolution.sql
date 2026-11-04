-- "Can't Park" rescue, part 3: the lifecycle job may no longer close a dispute.
--
-- 0015 deliberately let advance_reservations() complete 'disputed' bookings so one forgotten
-- report could never freeze a listing. That traded one bug for a worse one: the driver is
-- promised "full refund if it isn't resolved by HH:MM" (ArrivalActions), yet the booking turned
-- 'completed' minutes after the session ended, the report dropped out of every queue, and the
-- booking started counting towards revenue although the driver never parked.
--
-- This keeps 0015's safety valve but bounds it: a booking is held open only while its report is
-- still pending AND for at most 24 hours past the end of the session. After that it completes as
-- before (a listing can always be archived eventually) and the report stays 'pending' for the
-- admin queue at /admin/disputes, which is the real backstop.
--
-- Freezing a finished booking does not block anybody's future bookings: availability is decided
-- by time ranges, not by status. It only delays the host archiving the listing, which is why the
-- hold is finite.
--
-- Keep the 24 hour hold in step with DISPUTE_HOLD_HOURS in src/lib/disputes-window.ts.

create or replace function public.advance_reservations()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_active int := 0; n_done int := 0; n_warn int := 0; n_note int := 0; n_esc int := 0;
begin
  with up as (
    update reservations r set status = 'active'
     where r.status = 'upcoming' and r.start_time <= now() and r.end_time > now()
       and reservation_balance(r.id) >= 0
    returning r.id)
  select count(*) into n_active from up;

  -- Completion: 'disputed' stays in the list (0015) but a pending report buys the booking a
  -- grace period past its end time, so the refund decision is made while the dispute is visible.
  with done as (
    update reservations r set status = 'completed'
     where r.status in ('upcoming','active','disputed') and r.end_time <= now()
       and reservation_balance(r.id) >= 0
       and not (r.pending_extension is not null
                and coalesce((r.pending_extension->>'expires_at')::timestamptz, 'infinity') > now())
       and not (r.status = 'disputed'
                and exists (select 1 from arrival_issues a
                             where a.reservation_id = r.id and a.status = 'pending')
                and now() < r.end_time + interval '24 hours')
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

  -- Escalation: the owner's window has closed and nobody has acted. Tell every admin once per
  -- report, so the refund does not depend on someone remembering to open the queue.
  with stale as (
    select a.id, a.issue_type, a.resolution_deadline, coalesce(s.name, 'a slot') as slot_name,
           case a.issue_type
             when 'spot_occupied' then 'Spot occupied'
             when 'gate_locked' then 'Gate locked'
             when 'wrong_address' then 'Wrong address'
             else 'Other problem'
           end as label
      from arrival_issues a
      join reservations r on r.id = a.reservation_id
      join slots s on s.id = r.slot_id
     where a.status = 'pending'
       and a.resolution_deadline <= now()
       and not exists (select 1 from notifications x
                        where x.type = 'admin_arrival_issue'
                          and x.link = '/admin/disputes?i=' || a.id)),
  admins as (select user_id from user_roles where role = 'admin'),
  esc as (
    insert into notifications (user_id, type, title, body, link)
    select ad.user_id, 'admin_arrival_issue', 'Unresolved Can''t Park report',
           st.label || ' at ' || st.slot_name
             || ' — the owner''s 15 minute window has expired. Refund the driver or dismiss the report.',
           '/admin/disputes?i=' || st.id
      from stale st cross join admins ad
    returning 1)
  select count(*) into n_esc from esc;

  return jsonb_build_object(
    'activated', n_active, 'completed', n_done, 'ending_soon', n_warn,
    'completion_notices', n_note, 'escalated', n_esc);
end $$;
revoke execute on function public.advance_reservations() from public, anon, authenticated;
grant execute on function public.advance_reservations() to service_role;
