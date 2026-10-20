import { createFileRoute } from "@tanstack/react-router";
import { handle, options } from "@/lib/api-auth";
import { verifySchema } from "@/lib/payments.schema";

export const Route = createFileRoute("/api/public/payments/verify")({
  server: {
    handlers: {
      OPTIONS: options,
      POST: handle(async ({ ctx, body }) => (await import("@/lib/payments.server")).verifyPayment(ctx, verifySchema.parse(body))),
    },
  },
});
