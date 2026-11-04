import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PARKING_ISSUE_TYPES, PARKING_NOTE_MAX } from "@/lib/arrival-window";

const arriveSchema = z.object({
  reservationId: z.string().uuid(),
});

const lateSchema = z.object({
  reservationId: z.string().uuid(),
  minutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
});

const issueSchema = z.object({
  reservationId: z.string().uuid(),
  issueType: z.enum(PARKING_ISSUE_TYPES),
  note: z.string().trim().max(280).optional(),
});

const parkingNoteSchema = z.object({
  reservationId: z.string().uuid(),
  // Trimmed here and normalised in arrival.server.ts: an empty note clears the column.
  note: z.string().trim().max(PARKING_NOTE_MAX).optional(),
});

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const { ArrivalError } = await import("./arrival.server");
    if (e instanceof ArrivalError) throw new Error(e.message);
    console.error(e);
    throw new Error("Something went wrong");
  }
}

export const markArrivedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => arriveSchema.parse(d))
  .handler(async ({ data, context }) =>
    run(async () =>
      (await import("./arrival.server")).markArrived(context.userId, data.reservationId),
    ),
  );

export const markRunningLateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => lateSchema.parse(d))
  .handler(async ({ data, context }) =>
    run(async () =>
      (await import("./arrival.server")).markRunningLate(
        context.userId,
        data.reservationId,
        data.minutes,
      ),
    ),
  );

export const reportIssueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => issueSchema.parse(d))
  .handler(async ({ data, context }) =>
    run(async () =>
      (await import("./arrival.server")).reportArrivalIssue(
        context.userId,
        data.reservationId,
        data.issueType,
        data.note,
      ),
    ),
  );

/** "Find my car": save (or clear) the driver's own note about where the car is parked. */
export const saveParkingNoteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => parkingNoteSchema.parse(d))
  .handler(async ({ data, context }) =>
    run(async () =>
      (await import("./arrival.server")).saveParkingNote(
        context.userId,
        data.reservationId,
        data.note,
      ),
    ),
  );
