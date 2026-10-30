import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const arriveSchema = z.object({
  reservationId: z.string().uuid(),
});

const lateSchema = z.object({
  reservationId: z.string().uuid(),
  minutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
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