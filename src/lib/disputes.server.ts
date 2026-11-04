// Closing a "Can't Park" report. Two callers, two different rules:
//   • the host may say "I fixed it", but only inside their ISSUE_RESOLUTION_MINUTES window;
//   • an admin may fix it too, or refund the driver in full, at any time while it is open.
// Both must run on the server: guard_reservation_update() (migration 0010) refuses to move a
// booking out of 'disputed' from a browser session, and the refund path only exists here.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database as GeneratedDatabase, Json } from "@/integrations/supabase/types";
import type { Database } from "@/types/supabase-augment";
import { supabaseAdmin as rawAdmin } from "@/integrations/supabase/client.server";
import {
  adminCanResolve,
  issueLabel,
  ownerCanResolve,
  refundDuePaise,
  reservationAfterResolve,
  type DisputeAction,
} from "@/lib/disputes-window";
import { PaymentError, logEvent, rateLimit, refundReservation } from "@/lib/payments.server";

const db = rawAdmin as unknown as SupabaseClient<Database>;

export class DisputeError extends Error {}

type IssueRow = Database["public"]["Tables"]["arrival_issues"]["Row"];
type ReservationRow = Database["public"]["Tables"]["reservations"]["Row"];

export type ResolveResult = {
  action: DisputeAction;
  /** New status of the booking — 'cancelled' after a refund. */
  reservationStatus: "active" | "completed" | "cancelled";
  /** Paise actually queued for the driver (0 when nothing was owed). */
  refundedPaise: number;
};

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

/** rateLimit signals "slow down" with a PaymentError; reword it for this feature. */
async function limit(userId: string, bucket: "admin_refund" | "bookings_action") {
  try {
    await rateLimit(userId, bucket);
  } catch (e) {
    if (e instanceof PaymentError) throw new DisputeError(e.message);
    throw e;
  }
}

type Loaded = {
  issue: IssueRow;
  reservation: ReservationRow;
  slotName: string;
  ownerId: string | null;
};

async function load(issueId: string): Promise<Loaded> {
  const { data: issue } = await db
    .from("arrival_issues")
    .select("*")
    .eq("id", issueId)
    .maybeSingle();
  if (!issue) throw new DisputeError("That report no longer exists");
  const { data: reservation } = await db
    .from("reservations")
    .select("*")
    .eq("id", issue.reservation_id)
    .maybeSingle();
  if (!reservation) throw new DisputeError("That booking no longer exists");
  const { data: slot } = await db
    .from("slots")
    .select("name, owner_id")
    .eq("id", reservation.slot_id)
    .maybeSingle();
  return {
    issue,
    reservation,
    slotName: slot?.name ?? "the spot",
    ownerId: slot?.owner_id ?? null,
  };
}

/** Everything captured and not yet refunded on the booking, in paise. */
async function stillOwed(reservationId: string): Promise<number> {
  const [{ data: payments }, { data: refunds }] = await Promise.all([
    db.from("payments").select("amount_paise, status").eq("reservation_id", reservationId),
    db.from("refunds").select("amount_paise, status").eq("reservation_id", reservationId),
  ]);
  return refundDuePaise(payments ?? [], refunds ?? []);
}

async function tell(
  userId: string | null,
  type: string,
  title: string,
  body: string,
  link: string,
): Promise<void> {
  if (!userId) return;
  await db.from("notifications").insert({ user_id: userId, type, title, body, link, read: false });
}

/**
 * Claim the report: pending → resolved/rejected, exactly once. Returns false when somebody got
 * there first, so an admin and a host (or two admins) can never both act on the same report.
 */
async function claim(
  issueId: string,
  status: "resolved" | "rejected",
  actorId: string,
  note: string | null,
): Promise<boolean> {
  const { data } = await db
    .from("arrival_issues")
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: actorId,
      resolution_note: note,
    })
    .eq("id", issueId)
    .eq("status", "pending")
    .select("id");
  return !!data?.length;
}

/** Undo a claim so the admin can retry after the money step failed. Best effort only. */
async function unclaim(issueId: string): Promise<void> {
  await db
    .from("arrival_issues")
    .update({ status: "pending", resolved_at: null, resolved_by: null, resolution_note: null })
    .eq("id", issueId);
}

/**
 * Move the booking on from 'disputed'. Best effort: the report is already closed by now, and a
 * row that has moved on its own (the 24h hold expired) is not worth failing the whole action for.
 */
async function moveBooking(
  reservationId: string,
  status: ResolveResult["reservationStatus"],
  patch: Database["public"]["Tables"]["reservations"]["Update"] = {},
): Promise<void> {
  const { data } = await db
    .from("reservations")
    .update({ ...patch, status })
    .eq("id", reservationId)
    .eq("status", "disputed")
    .select("id");
  if (!data?.length)
    console.warn(`[disputes] booking ${reservationId} was no longer disputed → left as is`);
}

/**
 * Admin answer to a report. `refund` gives the driver everything they paid (there is no minimum
 * charge — a promised full refund is a full refund) and closes the booking as cancelled with
 * nothing billed; `remediate`/`reject` keep the booking and only close the report.
 */
export async function resolveDisputeAsAdmin(
  context: { supabase: SupabaseClient<GeneratedDatabase>; userId: string },
  issueId: string,
  action: DisputeAction,
  note?: string | null,
): Promise<ResolveResult> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new DisputeError("Forbidden");
  await limit(context.userId, "admin_refund");

  const { issue, reservation, slotName, ownerId } = await load(issueId);
  if (!adminCanResolve(issue)) throw new DisputeError("This report has already been closed");

  const label = issueLabel(issue.issue_type);
  const trimmed = note?.trim() || null;

  // Claim first: this single conditional update is what makes a double click, or a second admin,
  // harmless — the refund below can only ever run for the caller that won the claim.
  const claimed = await claim(
    issue.id,
    action === "reject" ? "rejected" : "resolved",
    context.userId,
    trimmed,
  );
  if (!claimed) throw new DisputeError("Someone else just handled this report");

  let refundedPaise = 0;
  if (action === "refund") {
    const owed = await stillOwed(issue.reservation_id);
    if (owed > 0) {
      try {
        // gst 0: the driver gets back exactly what was captured minus anything already refunded.
        // The key is the report id, so request_refund cannot pay twice even on a retry.
        refundedPaise = (
          await refundReservation(
            issue.reservation_id,
            owed,
            0,
            `Can't Park: ${label}`,
            `dispute:${issue.id}`,
            `admin:${context.userId}`,
          )
        ).queuedPaise;
      } catch (e) {
        // Nothing else has moved yet, so put the report back and let the admin simply retry.
        await unclaim(issue.id);
        console.error("[disputes] refund failed for issue", issue.id, e);
        throw new DisputeError(
          "The refund could not be created. Nothing was changed — please try again.",
        );
      }
    }
  }

  const nextStatus = reservationAfterResolve(reservation, action, Date.now());
  // A refunded booking is closed with nothing billed, so it never counts towards revenue.
  await moveBooking(
    issue.reservation_id,
    nextStatus,
    nextStatus === "cancelled"
      ? { final_price: 0, payment_expires_at: null, pending_extension: null }
      : {},
  );

  await logEvent(
    action === "refund" ? "dispute_refunded" : "dispute_resolved",
    issue.reservation_id,
    {
      amountPaise: refundedPaise || null,
      actor: `admin:${context.userId}`,
      reason: action,
      data: { issueId: issue.id, issueType: issue.issue_type, note: trimmed } as Json,
    },
  );

  const driverBody =
    action === "refund"
      ? refundedPaise > 0
        ? `${label} at ${slotName} — we have refunded ${rupees(refundedPaise)}. It reaches your account in 5-7 working days.`
        : `${label} at ${slotName} — there was nothing left to refund on this booking.`
      : action === "reject"
        ? `We reviewed your report "${label}" at ${slotName} and closed it without a refund.`
        : `${label} at ${slotName} — the host has fixed the problem, so your booking stands.`;
  await tell(
    reservation.driver_id,
    "arrival_issue_closed",
    action === "refund" ? "Refund approved" : "Your report was reviewed",
    driverBody,
    "/reservations",
  );
  await tell(
    ownerId,
    "arrival_issue_closed",
    "Usop resolved a driver's report",
    action === "refund"
      ? `A driver's report at ${slotName} (${label}) was upheld and refunded.`
      : `A driver's report at ${slotName} (${label}) was closed without a refund.`,
    "/bookings",
  );

  return { action, reservationStatus: nextStatus, refundedPaise };
}

/**
 * The host saying "I fixed it" inside their window. No money moves: the report is closed, the
 * booking goes back to being a normal one (or completes if the session is already over).
 */
export async function resolveDisputeAsOwner(
  context: { userId: string },
  issueId: string,
  note?: string | null,
): Promise<ResolveResult> {
  await limit(context.userId, "bookings_action");

  const { issue, reservation, slotName, ownerId } = await load(issueId);
  if (!ownerId || ownerId !== context.userId)
    throw new DisputeError("This booking is not on one of your spaces");
  if (!adminCanResolve(issue)) throw new DisputeError("This report has already been closed");
  if (!ownerCanResolve(issue))
    throw new DisputeError("Your window to fix this has passed — Usop support is handling it now.");
  if (reservation.status !== "disputed")
    throw new DisputeError("This booking is no longer disputed");

  const label = issueLabel(issue.issue_type);
  const trimmed = note?.trim() || null;
  if (!(await claim(issue.id, "resolved", context.userId, trimmed)))
    throw new DisputeError("Someone else just handled this report");

  const nextStatus = reservationAfterResolve(reservation, "remediate", Date.now());
  await moveBooking(issue.reservation_id, nextStatus);

  await tell(
    reservation.driver_id,
    "arrival_issue_closed",
    "The host fixed your parking problem",
    `${label} at ${slotName} — the host says it is sorted. If it is not, reply from My Reservations.`,
    "/reservations",
  );
  await logEvent("dispute_resolved", issue.reservation_id, {
    actor: context.userId,
    reason: "owner",
    data: { issueId: issue.id, issueType: issue.issue_type, note: trimmed } as Json,
  });

  return { action: "remediate", reservationStatus: nextStatus, refundedPaise: 0 };
}
