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
/** "Can't Park": the owner has this long to fix the problem before the driver is refunded. */
export const ISSUE_RESOLUTION_MINUTES = 15;
/** Longest "Find my car" note we accept, e.g. "Level B2, Pillar 14" (also a DB check). */
export const PARKING_NOTE_MAX = 120;

/** Reasons a driver can pick when the booked spot can't be used. */
export const PARKING_ISSUE_TYPES = [
  "spot_occupied",
  "gate_locked",
  "wrong_address",
  "other",
] as const;
export type ParkingIssueType = (typeof PARKING_ISSUE_TYPES)[number];

/** Driver-facing labels; the server reuses them in the owner's notification. */
export const PARKING_ISSUE_LABELS: Record<ParkingIssueType, string> = {
  spot_occupied: "Someone else is parked in my spot",
  gate_locked: "Gate or access is locked",
  wrong_address: "Address or directions are wrong",
  other: "Something else",
};

const MINUTE_MS = 60e3;
const OPEN_STATUSES = ["upcoming", "active"];
/** A "Find my car" note stays editable until the session ends — disputes included. */
const NOTE_STATUSES = ["upcoming", "active", "disputed"];

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
 * "Can't Park" is allowed once the session has started (active) and before end_time, and
 * only once per booking: an open report *is* the dispute.
 */
export function canReportParkingIssue(
  r: Pick<ArrivalTiming, "status" | "end_time"> & { pending_issue?: boolean },
  now = Date.now(),
): boolean {
  if (r.status !== "active") return false;
  if (r.pending_issue) return false;
  const end = timeMs(r.end_time);
  if (Number.isNaN(end)) return false;
  return now <= end;
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

/**
 * "Find my car" stays editable from before the start until the end time — a driver may
 * save it on the way, during the session, or while a dispute is open — but never after.
 */
export function canEditParkingNote(
  r: Pick<ArrivalTiming, "status" | "end_time">,
  now = Date.now(),
): boolean {
  if (!NOTE_STATUSES.includes(r.status)) return false;
  const end = timeMs(r.end_time);
  if (Number.isNaN(end)) return false;
  return now <= end;
}

/**
 * Trim and cap a note, turning "nothing" into null so saving an empty field clears the
 * column instead of storing whitespace. Server and UI both use this.
 */
export function normalizeParkingNote(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().slice(0, PARKING_NOTE_MAX);
  return trimmed.length > 0 ? trimmed : null;
}
