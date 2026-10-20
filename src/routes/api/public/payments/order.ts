import { createFileRoute } from "@tanstack/react-router";
import { handle, options } from "@/lib/api-auth";
import { orderSchema } from "@/lib/payments.schema";

export const Route = createFileRoute("/api/public/payments/order")({
  server: {
    handlers: {
      OPTIONS: options,
      POST: handle(async ({ ctx, body }) => (await import("@/lib/payments.server")).createOrder(ctx, orderSchema.parse(body)), { idempotent: "payments_order" }),
    },
  },
});
