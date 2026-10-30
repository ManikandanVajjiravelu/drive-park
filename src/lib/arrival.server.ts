import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin as rawAdmin } from "@/integrations/supabase/client.server";
import {
  ARRIVE_EARLY_MINUTES,
  LATE_GRACE_MINUTES,
  canMarkArrived,
  canReportLate,
} from "@/lib/arrival-window";
import { PaymentError, rateLimit } from "@/lib/payments.server";
import type { Database } from "@/types/supabase-augment";

// The generated types in src/integrations/supabase/types.ts lag migration 0012
// (arrived_at, late_notified_at); src/types/supabase-augment.ts adds them. Narrow the
// service-role client once here instead of casting every call site to `any`.
const db = rawAdmin as unknown as SupabaseClient<Database>;

export class ArrivalError extends Error {}

const VALID_MINUTES = [5, 10, 15, 30] as const;
type LateMinutes = (typeof VALID_MINUTES)[number];

/** Rate limit first, so a burst of taps never reaches the database. */
async function limit(userId: string, bucket: "arrival" | "late") {
  try {
    await rateLimit(userId, bucket);
  } catch (e) {
    // rateLimit signals "slow down" with a PaymentError; surface it as an arrival error.
    if (e instanceof PaymentError) throw new ArrivalError(e.message);
    throw e;
  }
}

/** Tell the slot owner. Only called when the reservation row actually changed. */
async function notifyOwner(
  slotId: string,
  build: (slotName: string) => { type: string; title: string; body: string },
) {
  const { data: slot } = await db
    .from("slots")
    .select("owner_id, name")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot?.owner_id) return;

  const message = build(slot.name ?? "your slot");
  await db.from("notifications").insert({
    user_id: slot.owner_id,
    type: message.type,
    title: message.title,
    body: message.body,
    link: "/reservations",
    read: false,
  });
}

export async function markArrived(userId: string, reservationId: string) {
  await limit(userId, "arrival");

  const { data: resv, error: rErr } = await db
    .from("reservations")
    .select("id, driver_id, slot_id, status, start_time, end_time, arrived_at")
    .eq("id", reservationId)
    .single();

  if (rErr || !resv) throw new ArrivalError("Reservation not found");
  if (resv.driver_id !== userId) throw new ArrivalError("Not your reservation");
  if (resv.arrived_at) return { alreadyArrived: true, arrivedAt: resv.arrived_at };

  const now = Date.now();
  if (!canMarkArrived(resv, now)) {
    if (!["upcoming", "active"].includes(resv.status)) {
      throw new ArrivalError(`Cannot mark arrival for ${resv.status} reservation`);
    }
    throw new ArrivalError(
      now < new Date(resv.start_time).getTime() - ARRIVE_EARLY_MINUTES * 60e3
        ? `You can tap "I'm here" from ${ARRIVE_EARLY_MINUTES} minutes before your start time`
        : "The arrival window for this booking has closed",
    );
  }

  const arrivedAt = new Date().toISOString();
  const { data: changed, error: uErr } = await db
    .from("reservations")
    .update({ arrived_at: arrivedAt })
    .eq("id", reservationId)
    .eq("driver_id", userId)
    .is("arrived_at", null)
    .select("id");

  if (uErr) throw new ArrivalError("Could not record arrival");

  if (!changed?.length) {
    // Lost the race (another tab tapped first): report the time that is stored.
    const { data: current } = await db
      .from("reservations")
      .select("arrived_at")
      .eq("id", reservationId)
      .maybeSingle();
    return { alreadyArrived: true, arrivedAt: current?.arrived_at ?? arrivedAt };
  }

  await notifyOwner(resv.slot_id, (slotName) => ({
    type: "arrival",
    title: "Driver arrived",
    body: `A driver has arrived at ${slotName}.`,
  }));

  return { alreadyArrived: false, arrivedAt };
}

export async function markRunningLate(userId: string, reservationId: string, minutes: number) {
  if (!VALID_MINUTES.includes(minutes as LateMinutes)) {
    throw new ArrivalError("Minutes must be 5, 10, 15, or 30");
  }

  await limit(userId, "late");

  const { data: resv, error: rErr } = await db
    .from("reservations")
    .select("id, driver_id, slot_id, status, start_time, late_notified_at")
    .eq("id", reservationId)
    .single();

  if (rErr || !resv) throw new ArrivalError("Reservation not found");
  if (resv.driver_id !== userId) throw new ArrivalError("Not your reservation");
  if (resv.late_notified_at) throw new ArrivalError("You already told the owner you are late");
  if (!canReportLate(resv)) {
    throw new ArrivalError(
      resv.status !== "upcoming"
        ? `Cannot mark late for ${resv.status} reservation`
        : `Running late can only be reported up to ${LATE_GRACE_MINUTES} minutes after your start time`,
    );
  }

  const lateNotifiedAt = new Date().toISOString();
  const { data: changed, error: uErr } = await db
    .from("reservations")
    .update({ late_notified_at: lateNotifiedAt })
    .eq("id", reservationId)
    .eq("driver_id", userId)
    .is("late_notified_at", null)
    .select("id");

  if (uErr) throw new ArrivalError("Could not record late notice");
  if (!changed?.length) throw new ArrivalError("You already told the owner you are late");

  await notifyOwner(resv.slot_id, (slotName) => ({
    type: "late_arrival",
    title: "Driver running late",
    body: `A driver is running ~${minutes} min late for ${slotName}.`,
  }));

  return { lateNotifiedAt, minutes };
}