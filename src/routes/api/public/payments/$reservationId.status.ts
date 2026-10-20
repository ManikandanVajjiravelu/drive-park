import { createFileRoute } from "@tanstack/react-router";
import { handle, options } from "@/lib/api-auth";
import { statusSchema } from "@/lib/payments.schema";

export const Route = createFileRoute("/api/public/payments/$reservationId/status")({
  server: {
    handlers: {
      OPTIONS: options,
      GET: handle(async ({ ctx, params }) =>
        (await import("@/lib/payments.server")).paymentStatus(ctx, statusSchema.parse({ reservationId: params.reservationId })),
      ),
    },
  },
});
