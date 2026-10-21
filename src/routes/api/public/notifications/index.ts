import { createFileRoute } from "@tanstack/react-router";
import { handle, options, HttpError } from "@/lib/api-auth";
import { notificationsActionSchema } from "@/lib/mobile.schema";
import { rateLimit } from "@/lib/payments.server";

export const Route = createFileRoute("/api/public/notifications/")({
  server: {
    handlers: {
      OPTIONS: options,
      GET: handle(async ({ ctx }) => {
        const { data, error } = await ctx.supabase
          .from("notifications")
          .select("*")
          .eq("user_id", ctx.userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw new HttpError(error.message, 500);
        return data ?? [];
      }),
      POST: handle(async ({ ctx, body }) => {
        await rateLimit(ctx.userId, "mobile_notifications");
        const input = notificationsActionSchema.parse(body);

        if (input.action === "mark_read") {
          const { data, error } = await ctx.supabase
            .from("notifications")
            .update({ read: true })
            .eq("id", input.id)
            .eq("user_id", ctx.userId)
            .select("id")
            .maybeSingle();
          if (error) throw new HttpError(error.message, 400);
          if (!data) throw new HttpError("Notification not found", 404);
          return { updated: 1, id: data.id };
        }

        // mark_all_read
        const { data, error } = await ctx.supabase
          .from("notifications")
          .update({ read: true })
          .eq("user_id", ctx.userId)
          .eq("read", false)
          .select("id");
        if (error) throw new HttpError(error.message, 400);
        return { updated: data?.length ?? 0 };
      }),
    },
  },
});
