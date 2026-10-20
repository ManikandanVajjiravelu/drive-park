import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { handle, options, HttpError } from "@/lib/api-auth";

export const Route = createFileRoute("/api/public/bookings/$id/$action")({
  server: {
    handlers: {
      OPTIONS: options,
      POST: handle(async ({ ctx, body, params }) => {
        const id = z.string().uuid().parse(params.id);
        const svc = await import("@/lib/bookings.server");
        switch (params.action) {
          case "cancel":
            return svc.cancelBooking(ctx.userId, id);
          case "end":
            return svc.endSession(ctx.userId, id);
          case "extend":
            return svc.extendBooking(ctx.userId, id, z.object({ minutes: z.number().int() }).parse(body).minutes);
          default:
            throw new HttpError("Unknown action", 404);
        }
      }),
    },
  },
});
