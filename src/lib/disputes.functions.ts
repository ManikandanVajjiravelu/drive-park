import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const resolveSchema = z.object({
  issueId: z.string().uuid(),
  action: z.enum(["refund", "remediate", "reject"]),
  /** Optional note, shown to the driver and kept on the report for the audit trail. */
  note: z.string().trim().max(280).optional(),
});

const ownerResolveSchema = z.object({
  issueId: z.string().uuid(),
  note: z.string().trim().max(280).optional(),
});

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const { DisputeError } = await import("./disputes.server");
    const { PaymentError } = await import("./payments.server");
    if (e instanceof DisputeError || e instanceof PaymentError) throw new Error(e.message);
    console.error(e);
    throw new Error("Something went wrong");
  }
}

/** Admin: refund the driver (full amount captured) or close the report without one. */
export const resolveDisputeAsAdminFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => resolveSchema.parse(d))
  .handler(async ({ data, context }) =>
    run(async () =>
      (await import("./disputes.server")).resolveDisputeAsAdmin(
        context,
        data.issueId,
        data.action,
        data.note,
      ),
    ),
  );

/** Host: "I fixed it" inside the 15 minute window — closes the report, no money moves. */
export const resolveDisputeAsOwnerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ownerResolveSchema.parse(d))
  .handler(async ({ data, context }) =>
    run(async () =>
      (await import("./disputes.server")).resolveDisputeAsOwner(context, data.issueId, data.note),
    ),
  );
