import { createFileRoute } from "@tanstack/react-router";
import { handle, options } from "@/lib/api-auth";
import { createBookingSchema } from "@/lib/bookings.schema";

export const Route = createFileRoute("/api/public/bookings/")({
  server: {
    handlers: {
      OPTIONS: options,
      POST: handle(async ({ ctx, body }) => {
        const { createBooking } = await import("@/lib/bookings.server");
        return createBooking(ctx.userId, createBookingSchema.parse(body));
      }, { idempotent: "bookings_create" }),
    },
  },
});
