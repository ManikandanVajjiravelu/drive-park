// Rules for closing a "Can't Park" report. Pure and shared: disputes.server.ts decides what
// gets written, and the owner/admin screens decide which buttons to show, both from this file —
// so the UI and the server can never disagree about who may resolve a dispute.
import {
  ISSUE_RESOLUTION_MINUTES,
  PARKING_ISSUE_LABELS,
  type ParkingIssueType,
} from "@/lib/arrival-window";

/**
 * How long a pending report keeps a finished booking out of the lifecycle job's completion.
 * Mirrors the `interval '24 hours'` in drizzle/migrations/0017_dispute_resolution.sql: after
 * this the booking completes as before and the report waits in the admin queue instead.
 */
export const DISPUTE_HOLD_HOURS = 24;

const MINUTE_MS = 60e3;
const HOUR_MS = 3600e3;

/** What closing the report does to the money. */
export type DisputeAction = "refund" | "remediate" | "reject";

export type DisputeIssueTiming = {
  status: string;
  resolution_deadline: string;
};

export type DisputeReservationTiming = {
  status: string;
  end_time: string;
};

type Money = { amount_paise: number | string; status: string };

const timeMs = (iso: string) => new Date(iso).getTime();

/** Only `captured`/later money can be refunded (payments.server.ts CAPTURED). */
const CAPTURED_STATUSES = ["captured", "partially_refunded", "refunded"];

export const isIssueOpen = (issue: Pick<DisputeIssueTiming, "status">) =>
  issue.status === "pending";

/**
 * The owner's own window: they may fix the problem and close the report themselves only until
 * `resolution_deadline` (ISSUE_RESOLUTION_MINUTES after the report). Afterwards the dispute
 * belongs to Usop — otherwise a host could silence a real problem and strand the driver.
 */
export function ownerCanResolve(issue: DisputeIssueTiming, now = Date.now()): boolean {
  if (!isIssueOpen(issue)) return false;
  const deadline = timeMs(issue.resolution_deadline);
  if (Number.isNaN(deadline)) return false;
  return now <= deadline;
}

/** Admins answer to nobody's deadline: they may resolve a report at any time while it is open. */
export const adminCanResolve = (issue: Pick<DisputeIssueTiming, "status">) => isIssueOpen(issue);

/**
 * The status a booking takes once its report is closed. A refund cancels the booking; fixing or
 * dismissing it returns the booking to the live section — or straight to completed when the
 * session is already over, so a stale row can never look like an active one.
 */
export function reservationAfterResolve(
  r: DisputeReservationTiming,
  action: DisputeAction,
  now = Date.now(),
): "cancelled" | "active" | "completed" {
  if (action === "refund") return "cancelled";
  const end = timeMs(r.end_time);
  if (Number.isNaN(end)) return "completed";
  return now < end ? "active" : "completed";
}

/**
 * What the driver is owed when their report turns out to be founded: everything captured and not
 * already refunded. No minimum charge and no REFUND_CONFIG.minRefundRupees floor — a promised
 * "full refund" is a full refund. The database still enforces the cap in request_refund (0002).
 */
export function refundDuePaise(payments: readonly Money[], refunds: readonly Money[]): number {
  const captured = payments
    .filter((p) => CAPTURED_STATUSES.includes(p.status))
    .reduce((s, p) => s + Number(p.amount_paise), 0);
  const already = refunds
    .filter((r) => r.status !== "failed")
    .reduce((s, r) => s + Number(r.amount_paise), 0);
  return Math.max(0, Math.floor(captured - already));
}

/** Driver-facing label for a report, falling back to the stored value for unknown types. */
export function issueLabel(issueType: string): string {
  return PARKING_ISSUE_LABELS[issueType as ParkingIssueType] ?? issueType;
}

/** True while the lifecycle job is holding a finished booking open because of the report. */
export function isHeldOpen(r: DisputeReservationTiming, now = Date.now()): boolean {
  const end = timeMs(r.end_time);
  if (Number.isNaN(end)) return false;
  return now > end && now < end + DISPUTE_HOLD_HOURS * HOUR_MS;
}

/**
 * What the driver should see instead of a finished countdown while a dispute is open:
 * the owner's remaining minutes, or an acknowledgement once it is with Usop.
 */
export function disputeStage(
  r: DisputeReservationTiming & { pending_issue?: { resolution_deadline: string } | null },
  now = Date.now(),
): "none" | "owner" | "usop" {
  if (!r.pending_issue) return "none";
  return ownerCanResolve(
    { status: "pending", resolution_deadline: r.pending_issue.resolution_deadline },
    now,
  )
    ? "owner"
    : "usop";
}

/** Minutes left in the owner's window, floored at 0 (for the "resolve by …" copy). */
export function ownerMinutesLeft(issue: DisputeIssueTiming, now = Date.now()): number {
  const deadline = timeMs(issue.resolution_deadline);
  if (Number.isNaN(deadline)) return 0;
  return Math.max(0, Math.ceil((deadline - now) / MINUTE_MS));
}

/** The promise the driver was given, kept in one place so every screen words it the same way. */
export const OWNER_WINDOW_COPY = `the host has ${ISSUE_RESOLUTION_MINUTES} minutes to fix it`;
