// Server-only booking logic shared by server functions and the mobile HTTPS routes.
// All money values are computed here from database state; clients never supply prices.
import { createBookingSchema, type CreateBookingInput } from "@/lib/bookings.schema";
import {
  isV2Breakdown,
  priceWithParams,
  type LocationTier,
  type OccupancyRow,
  type PeerCandidate,
  type SlotType,
  DEMAND_RADIUS_KM,
} from "@/lib/pricing";
import { checkWithinHours } from "@/lib/availability";
import {
  asIstLocal,
  demandFromRows,
  quoteFromData,
  UNIT_MS,
  type DemandInputs,
  type QuoteSlot,
  type RateType,
} from "@/lib/quote";
import type { SlotAvailability } from "@/lib/queries";
import {
  REFUND_CONFIG,
  cancellationRefundShare,
  earlyEndChargePaise,
  earlyEndChargePaiseV2,
  refundablePaise,
  extensionPrice,
  extensionPriceV2,
  toPaise,
} from "@/lib/refund-policy";

export const MAX_UNPAID_HOLDS = REFUND_CONFIG.maxUnpaidHolds;
export const PAYMENT_HOLD_MS = REFUND_CONFIG.holdMinutes * 60 * 1000;

export class BookingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export class PriceChangedError extends BookingError {
  constructor(public newTotal: number) {
    super(`Price changed to ₹${newTotal}. Please review and confirm again.`, 409);
  }
}

export { createBookingSchema };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type Db = Awaited<ReturnType<typeof admin>>;

/**
 * Pricing inputs for a booking window. Occupancy counts only reservations overlapping
 * [start, end) that are not cancelled and not expired unpaid holds: distinct slots in the lot
 * (vs total_slots) or, for independent slots, approved non-archived slots within
 * DEMAND_RADIUS_KM of the slot's exact position. Fewer than MIN_DEMAND_PEERS nearby spaces
 * → demand is neutral. Exact coordinates are read here with the admin client only and are
 * never returned. Location tier only applies when the slot belongs to a lot with an explicit tier.
 */
export async function pricingInputs(
  db: Db,
  slot: {
    id?: string;
    lot_id: string | null;
  },
  start: Date,
  end: Date,
) {
  let lot: { tier: string | null; total_slots: number } | null = null;
  if (slot.lot_id) {
    const { data } = await db
      .from("parking_lots")
      .select("tier, total_slots")
      .eq("id", slot.lot_id)
      .maybeSingle();
    lot = data ?? null;
  }
  let peers: (PeerCandidate & { lot_id: string | null })[] = [];
  if (lot && lot.total_slots > 0) {
    const { data: inLot } = await db
      .from("slots")
      .select("id, lat, lng, approval_status, archived, lot_id")
      .eq("lot_id", slot.lot_id!);
    peers = (inLot ?? []) as typeof peers;
  } else if (slot.id) {
    const { data: self } = await db
      .from("slots")
      .select("id, lat, lng, approval_status, archived, lot_id")
      .eq("id", slot.id)
      .maybeSingle();
    if (self) {
      // Bounding box prefilter (~1 km in latitude), exact distance check in code.
      const dLat = DEMAND_RADIUS_KM / 111 + 0.001;
      const dLng = dLat / Math.max(0.1, Math.cos((Number(self.lat) * Math.PI) / 180));
      const { data: near } = await db
        .from("slots")
        .select("id, lat, lng, approval_status, archived, lot_id")
        .gte("lat", Number(self.lat) - dLat)
        .lte("lat", Number(self.lat) + dLat)
        .gte("lng", Number(self.lng) - dLng)
        .lte("lng", Number(self.lng) + dLng);
      peers = [self, ...(near ?? []).filter((n) => n.id !== self.id)] as typeof peers;
    }
  }
  peers = peers.map((c) => ({ ...c, lat: Number(c.lat), lng: Number(c.lng) }));
  const probe = demandFromRows(
    { id: slot.id ?? "", lot_id: slot.lot_id },
    peers,
    lot,
    [],
    start,
    end,
  );
  let rows: OccupancyRow[] = [];
  if (!probe.demandNeutral && peers.length) {
    const { data } = await db
      .from("reservations")
      .select("slot_id, status, start_time, end_time, payment_expires_at")
      .in(
        "slot_id",
        peers.map((p) => p.id),
      )
      .neq("status", "cancelled")
      .lt("start_time", end.toISOString())
      .gt("end_time", start.toISOString());
    rows = (data ?? []) as OccupancyRow[];
  }
  const d = demandFromRows(
    { id: slot.id ?? "", lot_id: slot.lot_id },
    peers,
    lot,
    rows,
    start,
    end,
  );
  const { data: holidays } = await db.from("public_holidays").select("date");
  return {
    tier: d.tier,
    occupied: d.occupied,
    total: d.total,
    demandNeutral: d.demandNeutral,
    holidays: (holidays ?? []).map((h) => h.date as string),
  };
}

/**
 * Availability + price for one slot and window — the single quote used by createBooking
 * (and mirrored in batch by search.server.ts through the same quoteFromData).
 */
export async function quoteWindow(
  db: Db,
  slot: QuoteSlot,
  input: { startTime: Date; duration: number; rateType: RateType },
  now: Date = new Date(),
) {
  const end = new Date(input.startTime.getTime() + input.duration * UNIT_MS[input.rateType]);
  const { data: hours } = await db.from("slot_availability").select("*").eq("slot_id", slot.id);
  const { data: overlapping } = await db
    .from("reservations")
    .select("slot_id, status, start_time, end_time, payment_expires_at")
    .eq("slot_id", slot.id)
    .neq("status", "cancelled")
    .lt("start_time", end.toISOString())
    .gt("end_time", input.startTime.toISOString());
  let demand: DemandInputs | null = null;
  let holidays: string[] = [];
  if (input.rateType === "hourly") {
    const p = await pricingInputs(db, slot, input.startTime, end);
    demand = p;
    holidays = p.holidays;
  }
  return quoteFromData(
    slot,
    input,
    {
      hours: (hours ?? []) as SlotAvailability[],
      reservations: (overlapping ?? []) as OccupancyRow[],
      holidays,
      demand,
    },
    now,
  );
}

export async function createBooking(userId: string, input: CreateBookingInput) {
  const db = await admin();
  const { rateLimit } = await import("@/lib/payments.server");
  await rateLimit(userId, "bookings_create");
  await db.rpc("expire_unpaid_reservations");

  const { data: slot } = await db
    .from("slots")
    .select(
      "id, owner_id, status, archived, is_available, approval_status, slot_type, base_rate, lot_id, approx_area, hourly_rate, daily_rate, monthly_rate",
    )
    .eq("id", input.slotId)
    .maybeSingle();
  if (!slot) throw new BookingError("Slot not found", 404);
  if (slot.owner_id === userId) throw new BookingError("You can't book your own slot");

  const quote = await quoteWindow(db, slot, {
    startTime: new Date(input.startTime),
    duration: input.duration,
    rateType: input.rateType,
  });
  if (!quote.available)
    throw new BookingError(quote.message ?? "Not available", quote.reason === "booked" ? 409 : 400);
  const { start, end } = quote;

  let vehiclePlate: string | null = null;
  if (input.vehicleId) {
    const { data: v } = await db
      .from("vehicles")
      .select("plate")
      .eq("id", input.vehicleId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!v) throw new BookingError("Vehicle not found");
    vehiclePlate = v.plate;
  }

  const breakdown = quote.breakdown;
  const subtotal = quote.subtotal;
  const gst = quote.gst;
  const grandTotal = quote.grandTotal;
  // Never silently charge a different amount than the driver confirmed.
  if (input.expectedTotal != null && Math.abs(grandTotal - input.expectedTotal) > 1)
    throw new PriceChangedError(grandTotal);
  const status = start.getTime() <= Date.now() ? "active" : "upcoming";

  const { data: row, error } = await db
    .from("reservations")
    .insert({
      driver_id: userId,
      slot_id: slot.id,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status,
      rate_type: input.rateType,
      total_price: grandTotal,
      grand_total: grandTotal,
      amount_charged: grandTotal,
      subtotal_amount: subtotal,
      gst_amount: breakdown ? gst : null,
      base_rate: breakdown?.baseRate ?? Number(slot[`${input.rateType}_rate`]),
      final_price_per_hour: breakdown?.finalPricePerHour ?? null,
      price_breakdown: breakdown ? JSON.parse(JSON.stringify(breakdown)) : null,
      vehicle_id: input.vehicleId ?? null,
      vehicle_plate: vehiclePlate,
      payment_expires_at:
        grandTotal > 0 ? new Date(Date.now() + PAYMENT_HOLD_MS).toISOString() : null,
    })
    .select("id")
    .single();
  if (error) {
    if (/HOLD_LIMIT/.test(error.message))
      throw new BookingError(
        "Please pay for or cancel your unpaid bookings before making another.",
        429,
      );
    if (/no_overlap|exclusion|conflicting key/i.test(error.message))
      throw new BookingError("That time is already booked. Try a different slot or time.", 409);
    throw new BookingError("Could not create booking", 500);
  }

  if (input.promoCode) {
    const { data: discount, error: promoErr } = await db.rpc("redeem_promo", {
      _code: input.promoCode,
      _user_id: userId,
      _subtotal: grandTotal,
      _reservation_id: row.id,
    });
    if (promoErr) {
      await db
        .from("reservations")
        .update({ status: "cancelled", payment_expires_at: null, final_price: 0 })
        .eq("id", row.id);
      throw new BookingError(promoErr.message.replace(/^.*?:\s*/, ""));
    }
    const d = Number(discount ?? 0);
    const discounted = Math.max(0, Math.round(grandTotal - d));
    await db
      .from("reservations")
      .update({
        discount_amount: d,
        promo_code: input.promoCode.toUpperCase(),
        total_price: discounted,
        grand_total: discounted,
        amount_charged: discounted,
        ...(discounted === 0 ? { payment_expires_at: null } : {}),
      })
      .eq("id", row.id);
    return { reservationId: row.id, grandTotal: discounted };
  }
  return { reservationId: row.id, grandTotal };
}

async function ownReservation(userId: string, id: string) {
  const db = await admin();
  await db.rpc("expire_unpaid_reservations");
  const { data: r } = await db
    .from("reservations")
    .select(
      "id, driver_id, slot_id, start_time, end_time, status, total_price, grand_total, subtotal_amount, gst_amount, rate_type, price_breakdown, payment_expires_at, created_at, extended_minutes, pending_extension",
    )
    .eq("id", id)
    .maybeSingle();
  if (!r || r.driver_id !== userId) throw new BookingError("Booking not found", 404);
  return { db, r };
}

async function capturedPayments(id: string) {
  const db = await admin();
  const { data } = await db
    .from("payments")
    .select("id, created_at, amount_paise")
    .eq("reservation_id", id)
    .in("status", ["captured", "partially_refunded"])
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** GST share of the money charged (from stored amounts, not the base rate). */
function gstRatio(r: { gst_amount: number | null; subtotal_amount: number | null }) {
  const gst = Number(r.gst_amount ?? 0);
  const sub = Number(r.subtotal_amount ?? 0);
  return gst > 0 && sub + gst > 0 ? gst / (sub + gst) : 0;
}

type PricedReservation = { start_time: string; end_time: string; price_breakdown: unknown };

/**
 * Amount kept (paise) when ending early. Pricing v2: the price recomputed for the time actually
 * used with the stored parameters (1-hour minimum, capped at charged). Older bookings without a
 * pricingVersion keep the v1 pro-rata rule.
 */
export function earlyEndKeptPaise(
  r: PricedReservation,
  chargedPaise: number,
  nowMs: number,
): number {
  const startMs = new Date(r.start_time).getTime();
  const endMs = new Date(r.end_time).getTime();
  const pb = r.price_breakdown;
  if (isV2Breakdown(pb)) {
    const start = new Date(startMs);
    return earlyEndChargePaiseV2(
      chargedPaise,
      (h) => priceWithParams(pb, start, h).grandTotal * 100,
      startMs,
      endMs,
      nowMs,
    );
  }
  return earlyEndChargePaise(chargedPaise, startMs, endMs, nowMs);
}

/** Pricing v2 extension cost in rupees, or null for older bookings (use the v1 rule). */
export function extensionCost(r: PricedReservation, minutes: number): number | null {
  const pb = r.price_breakdown;
  if (!isV2Breakdown(pb)) return null;
  const start = new Date(r.start_time);
  const oldH = (new Date(r.end_time).getTime() - start.getTime()) / 3600e3;
  return extensionPriceV2(
    (h) => priceWithParams(pb, start, h).grandTotal,
    oldH,
    oldH + minutes / 60,
  );
}

/** Pricing v1 extension rule, unchanged, for reservations created before pricingVersion 2. */
async function legacyExtensionCost(
  db: Db,
  r: { price_breakdown: unknown; slot_id: string; rate_type: string },
  minutes: number,
) {
  const pb = r.price_breakdown as {
    finalPricePerHour?: number;
    gst?: number;
    subtotal?: number;
  } | null;
  let perHour = pb?.finalPricePerHour;
  let gstRate = pb?.subtotal && pb.gst ? pb.gst / pb.subtotal : 0;
  if (!perHour) {
    const { data: s } = await db
      .from("slots")
      .select("hourly_rate, daily_rate, monthly_rate")
      .eq("id", r.slot_id)
      .single();
    perHour =
      r.rate_type === "hourly"
        ? Number(s!.hourly_rate)
        : r.rate_type === "daily"
          ? Number(s!.daily_rate) / 24
          : Number(s!.monthly_rate) / 720;
    gstRate = 0;
  }
  return extensionPrice(perHour, minutes, gstRate);
}

/** End an active session early; keep the recomputed (v2) or pro-rata (v1) amount and refund the rest. */
export async function endSession(userId: string, id: string) {
  const { rateLimit } = await import("@/lib/payments.server");
  await rateLimit(userId, "bookings_action");
  const { db, r } = await ownReservation(userId, id);
  const startMs = new Date(r.start_time).getTime();
  const endMs = new Date(r.end_time).getTime();
  const nowMs = Math.min(Date.now(), endMs);
  if (startMs > Date.now()) throw new BookingError("Only an active session can be ended");

  const chargedPaise = toPaise(Number(r.total_price));
  const keptPaise = earlyEndKeptPaise(r, chargedPaise, nowMs);
  const paid = (await capturedPayments(id)).length > 0;
  if (r.payment_expires_at != null || (!paid && chargedPaise > 0))
    throw new BookingError("Please pay for this booking first", 409);
  const refundPaise = paid ? refundablePaise(chargedPaise - keptPaise) : 0;
  const billedPaise = paid ? chargedPaise - refundPaise : keptPaise;

  // Conditional transition: only one of end/cancel can win.
  const { data: won } = await db
    .from("reservations")
    .update({
      status: "completed",
      end_time: new Date(Math.max(nowMs, startMs + 60e3)).toISOString(),
      final_price: billedPaise / 100,
      pending_extension: null,
      payment_expires_at: null,
    })
    .eq("id", id)
    // "disputed" is an active session with an open driver report: the driver must still be
    // able to end it (the refund itself is handled by support while the report is open).
    .in("status", ["active", "upcoming", "disputed"])
    .lte("start_time", new Date().toISOString())
    .select("id");
  if (!won?.length) throw new BookingError("Only an active session can be ended", 409);

  const { refundReservation, logEvent } = await import("@/lib/payments.server");
  await logEvent("session_ended", id, { amountPaise: billedPaise, actor: userId });
  let queued = 0;
  if (refundPaise > 0)
    queued = (
      await refundReservation(
        id,
        refundPaise,
        Math.floor(refundPaise * gstRatio(r)),
        "Session ended early",
        `end:${id}`,
        userId,
      )
    ).queuedPaise;
  return { finalPrice: billedPaise / 100, refund: queued / 100, refundPaise: queued };
}

/**
 * Request an extension. Paid bookings must pay the extra first; end_time only moves once that
 * payment is captured (apply_extension). The price is fixed at request time.
 */
export async function extendBooking(userId: string, id: string, minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240)
    throw new BookingError("Invalid extension");
  const { rateLimit } = await import("@/lib/payments.server");
  await rateLimit(userId, "bookings_action");
  const { db, r } = await ownReservation(userId, id);
  if (r.status !== "active" && r.status !== "upcoming")
    throw new BookingError("This booking can't be extended");
  if (new Date(r.end_time).getTime() <= Date.now())
    throw new BookingError("This booking has already ended");
  if (r.payment_expires_at)
    throw new BookingError("Please pay for this booking before extending it");
  if ((r.extended_minutes ?? 0) + minutes > REFUND_CONFIG.maxExtensionMinutes)
    throw new BookingError(
      `Bookings can be extended by at most ${REFUND_CONFIG.maxExtensionMinutes / 60} hours in total`,
    );

  const newEnd = new Date(new Date(r.end_time).getTime() + minutes * 60e3);
  const { data: hours } = await db.from("slot_availability").select("*").eq("slot_id", r.slot_id);
  const hoursError = checkWithinHours(
    (hours ?? []) as SlotAvailability[],
    asIstLocal(new Date(r.start_time)),
    asIstLocal(newEnd),
  );
  if (hoursError) throw new BookingError(hoursError);

  const { count: clash } = await db
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", r.slot_id)
    .neq("id", id)
    .neq("status", "cancelled")
    .lt("start_time", newEnd.toISOString())
    .gt("end_time", r.end_time);
  if ((clash ?? 0) > 0) throw new BookingError("The slot is booked right after you", 409);

  const extra = extensionCost(r, minutes) ?? (await legacyExtensionCost(db, r, minutes));
  const paid = (await capturedPayments(id)).length > 0;

  if (extra <= 0 || !paid) {
    const price = Number(r.total_price) + extra;
    const { error } = await db
      .from("reservations")
      .update({
        end_time: newEnd.toISOString(),
        total_price: price,
        grand_total: price,
        extended_minutes: (r.extended_minutes ?? 0) + minutes,
        pending_extension: null,
      })
      .eq("id", id);
    if (error) {
      if (/no_overlap|exclusion/i.test(error.message))
        throw new BookingError("The slot is booked right after you", 409);
      throw new BookingError("Could not extend", 500);
    }
    return { extraCost: extra, endTime: newEnd.toISOString(), needsPayment: false };
  }

  const expiresAt = new Date(Date.now() + REFUND_CONFIG.holdMinutes * 60e3).toISOString();
  const { data: ok } = await db.rpc("set_pending_extension", {
    _id: id,
    _ext: { minutes, new_end: newEnd.toISOString(), extra, expires_at: expiresAt },
  });
  if (!ok)
    throw new BookingError("An extension is already waiting for payment on this booking", 409);
  const { logEvent } = await import("@/lib/payments.server");
  await logEvent("extension_requested", id, {
    amountPaise: toPaise(extra),
    actor: userId,
    data: { minutes },
  });
  return {
    extraCost: extra,
    endTime: newEnd.toISOString(),
    needsPayment: true,
    paymentExpiresAt: expiresAt,
  };
}

/** Cancel before start; refund per the slot's cancellation policy (plus grace window). */
export async function cancelBooking(userId: string, id: string) {
  const { rateLimit } = await import("@/lib/payments.server");
  await rateLimit(userId, "bookings_action");
  const { db, r } = await ownReservation(userId, id);
  if (r.status !== "upcoming" || new Date(r.start_time).getTime() <= Date.now())
    throw new BookingError("Only upcoming bookings can be cancelled");

  const pays = await capturedPayments(id);
  const chargedPaise = toPaise(Number(r.total_price));
  let refundPaise = 0;
  if (pays.length) {
    const { data: slot } = await db
      .from("slots")
      .select("cancellation_policy")
      .eq("id", r.slot_id)
      .single();
    const graceFrom = [r.created_at, pays[0].created_at].sort().at(-1)!;
    const share = cancellationRefundShare(
      slot?.cancellation_policy ?? "flexible",
      r.start_time,
      Date.now(),
      graceFrom,
    );
    refundPaise = refundablePaise(chargedPaise * share);
  }
  const billedPaise = pays.length ? chargedPaise - refundPaise : 0;

  const { data: won } = await db
    .from("reservations")
    .update({
      status: "cancelled",
      payment_expires_at: null,
      pending_extension: null,
      final_price: billedPaise / 100,
    })
    .eq("id", id)
    .eq("status", "upcoming")
    .gt("start_time", new Date().toISOString())
    .select("id");
  if (!won?.length) throw new BookingError("This booking can no longer be cancelled", 409);

  const { refundReservation, logEvent } = await import("@/lib/payments.server");
  await logEvent("cancelled", id, { amountPaise: billedPaise, actor: userId });
  if (!pays.length) {
    await db.rpc("release_promo", { _reservation_id: id });
    return { ok: true, refund: 0, refundPaise: 0 };
  }
  let queued = 0;
  if (refundPaise > 0)
    queued = (
      await refundReservation(
        id,
        refundPaise,
        Math.floor(refundPaise * gstRatio(r)),
        "Cancelled by driver",
        `cancel:${id}`,
        userId,
      )
    ).queuedPaise;
  return { ok: true, refund: queued / 100, refundPaise: queued };
}
