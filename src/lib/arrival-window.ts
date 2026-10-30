// Window rules for the driver's "I am here" and "Running late" taps.
// Pure and shared: arrival.server.ts and ArrivalActions.tsx both call these, so the
// button a driver sees and what the server accepts can never disagree.

export type ArrivalTiming = {
  status: string;
  start_time: string;
  end_time: string;
  arrived_at?: string | null;
  late_notified_at?: string | null;
};

/** "I am here" opens this many minutes before the start time. */
export const ARRIVE_EARLY_MINUTES = 30;
/** "Running late" closes this many minutes after the start time. */
export const LATE_GRACE_MINUTES = 15;

const MINUTE_MS = 60e3;
const OPEN_STATUSES = ["upcoming", "active"];

const timeMs = (iso: string) => new Date(iso).getTime();

/**
 * "I am here" is allowed from ARRIVE_EARLY_MINUTES before start_time until end_time,
 * for a booking that is still upcoming or active, and only once.
 */
export function canMarkArrived(
  r: Pick<ArrivalTiming, "status" | "start_time" | "end_time" | "arrived_at">,
  now = Date.now(),
): boolean {
  if (!OPEN_STATUSES.includes(r.status)) return false;
  if (r.arrived_at) return false;
  const start = timeMs(r.start_time);
  const end = timeMs(r.end_time);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return now >= start - ARRIVE_EARLY_MINUTES * MINUTE_MS && now <= end;
}

/**
 * "Running late" is allowed only while the booking is still upcoming, before
 * start_time + LATE_GRACE_MINUTES, and only once (late_notified_at stays null).
 */
export function canReportLate(
  r: Pick<ArrivalTiming, "status" | "start_time" | "late_notified_at">,
  now = Date.now(),
): boolean {
  if (r.status !== "upcoming") return false;
  if (r.late_notified_at) return false;
  const start = timeMs(r.start_time);
  if (Number.isNaN(start)) return false;
  return now < start + LATE_GRACE_MINUTES * MINUTE_MS;
}