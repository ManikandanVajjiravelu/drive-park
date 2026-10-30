// Single source of truth for money rules: refund percentages, cutoffs, grace window,
// minimum charges, limits and paise conversion. Server and UI both read from here.

export type CancellationPolicy = "flexible" | "moderate" | "strict";

export const REFUND_CONFIG = {
  policies: {
    // fullUntilHours: full refund if cancelled at least this many hours before start.
    // insideShare: share refunded when cancelled inside that window but before start.
    flexible: { fullUntilHours: 0, insideShare: 1 },
    moderate: { fullUntilHours: 24, insideShare: 0.5 },
    strict: { fullUntilHours: 48, insideShare: 0 },
  } satisfies Record<CancellationPolicy, { fullUntilHours: number; insideShare: number }>,
  /** Full refund if cancelled within this many minutes of booking/payment… */
  graceMinutes: 10,
  /** …as long as the start is at least this many hours away. */
  graceMinStartHours: 1,
  /** Early end: minimum charge in hours (never more than the amount charged). */
  minChargeHours: 1,
  /** Refunds below this (rupees) are not issued. */
  minRefundRupees: 10,
  /** Max total extension per booking (minutes). */
  maxExtensionMinutes: 8 * 60,
  /** Unpaid booking hold and extension payment window (minutes). */
  holdMinutes: 15,
  /** Max concurrent unpaid holds per user (also enforced in the database trigger). */
  maxUnpaidHolds: 2,
  /** Per-user, per-minute request limits. */
  rateLimits: {
    bookings_create: 5,
    bookings_action: 20,
    /** "I am here" / "Running late" taps per minute. */
    arrival: 10,
    late: 10,
    payments_order: 10,
    payments_verify: 20,
    admin_refund: 30,
    /** Time-window searches per minute. */
    search_window: 30,
    /** Mobile /api/public/* mutating endpoints (POST only), per minute. */
    mobile_profile: 30,
    mobile_vehicles: 30,
    mobile_notifications: 30,
  },
  /** Payments stuck in created/authorized longer than this are reconciled with Razorpay. */
  reconcileAfterMinutes: 30,
  /** Refund retry backoff (minutes) by attempt number; last value repeats. */
  retryBackoffMinutes: [1, 5, 15, 60, 240],
} as const;

/** Rupees → paise. Rule: floor to whole paise (never round a refund or charge up). */
export const toPaise = (rupees: number) => Math.floor(Math.round(rupees * 1000) / 10);
export const toRupees = (paise: number) => paise / 100;

const policyOf = (p: string): CancellationPolicy =>
  p === "moderate" || p === "strict" ? p : "flexible";

/** Driver-facing wording, generated from the config so the UI always matches the code. */
export function policyBlurb(policy: CancellationPolicy): string {
  const c = REFUND_CONFIG.policies[policy];
  if (c.fullUntilHours === 0) return "Full refund any time before the start.";
  const inside = c.insideShare === 0 ? "no refund" : `${Math.round(c.insideShare * 100)}% refund`;
  return `Full refund until ${c.fullUntilHours}h before start; ${inside} after that. No cancelling once started.`;
}

/**
 * Share (0..1) refunded on cancellation before start.
 * `graceFrom` is the later of booking creation and last payment time.
 */
export function cancellationRefundShare(
  policy: string,
  startIso: string,
  now = Date.now(),
  graceFrom?: string | null,
): number {
  const msBefore = new Date(startIso).getTime() - now;
  if (msBefore <= 0) return 0;
  if (graceFrom) {
    const since = now - new Date(graceFrom).getTime();
    if (
      since >= 0 &&
      since <= REFUND_CONFIG.graceMinutes * 60e3 &&
      msBefore >= REFUND_CONFIG.graceMinStartHours * 3600e3
    )
      return 1;
  }
  const c = REFUND_CONFIG.policies[policyOf(policy)];
  if (msBefore >= c.fullUntilHours * 3600e3) return 1;
  return c.insideShare;
}

/**
 * Amount kept (paise) when a session ends early: pro-rata for time used, with a minimum
 * charge of `minChargeHours`, never more than what was charged.
 */
export function earlyEndChargePaise(
  chargedPaise: number,
  startMs: number,
  endMs: number,
  nowMs: number,
): number {
  const span = Math.max(1, endMs - startMs);
  const used = Math.min(span, Math.max(0, nowMs - startMs));
  const prorata = (chargedPaise * used) / span;
  const minimum = (chargedPaise * Math.min(span, REFUND_CONFIG.minChargeHours * 3600e3)) / span;
  return Math.min(chargedPaise, Math.ceil(Math.max(prorata, minimum)));
}

/** Refund amount in paise after the minimum rule (0 = skip). Floors to whole paise. */
export function refundablePaise(paise: number): number {
  const p = Math.floor(paise);
  return p >= REFUND_CONFIG.minRefundRupees * 100 ? p : 0;
}

/** GST portion of a refund, proportional to the GST in the amount charged. */
export function gstShareOfRefund(
  refundPaise: number,
  chargedPaise: number,
  gstPaise: number,
): number {
  if (chargedPaise <= 0 || gstPaise <= 0) return 0;
  return Math.floor((refundPaise * gstPaise) / chargedPaise);
}

/** Extension price in rupees, using the same rounding/GST rule as the original booking (pricing v1). */
export function extensionPrice(perHourExGst: number, minutes: number, gstRate: number): number {
  const subtotal = perHourExGst * (minutes / 60);
  return Math.round(subtotal + subtotal * gstRate);
}

/**
 * Pricing v2 extension price (rupees, GST included): price(new duration) − price(old duration),
 * both computed with the same stored parameters. `totalForHours` returns the rounded grand total.
 */
export function extensionPriceV2(
  totalForHours: (hours: number) => number,
  oldHours: number,
  newHours: number,
): number {
  return Math.max(0, totalForHours(newHours) - totalForHours(oldHours));
}

/**
 * Pricing v2 early end (paise kept): the price recomputed for the time actually used
 * (minimum `minChargeHours`, never more than the booked span), never more than what was charged.
 */
export function earlyEndChargePaiseV2(
  chargedPaise: number,
  totalPaiseForHours: (hours: number) => number,
  startMs: number,
  endMs: number,
  nowMs: number,
): number {
  const spanH = Math.max(0, endMs - startMs) / 3600e3;
  const usedH = Math.min(spanH, Math.max(0, nowMs - startMs) / 3600e3);
  const billedH = Math.min(spanH, Math.max(usedH, REFUND_CONFIG.minChargeHours));
  return Math.min(chargedPaise, Math.ceil(totalPaiseForHours(billedH)));
}
