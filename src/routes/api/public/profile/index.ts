import { createFileRoute } from "@tanstack/react-router";
import { handle, options, HttpError } from "@/lib/api-auth";
import { updateProfileSchema } from "@/lib/mobile.schema";
import { rateLimit } from "@/lib/payments.server";

export const Route = createFileRoute("/api/public/profile/")({
  server: {
    handlers: {
      OPTIONS: options,
      GET: handle(async ({ ctx }) => {
        const { data, error } = await ctx.supabase
          .from("profiles")
          .select("*")
          .eq("id", ctx.userId)
          .maybeSingle();
        if (error) throw new HttpError(error.message, 500);
        if (!data) throw new HttpError("Profile not found", 404);
        return data;
      }),
      POST: handle(async ({ ctx, body }) => {
        await rateLimit(ctx.userId, "mobile_profile");
        const input = updateProfileSchema.parse(body);
        const { data, error } = await ctx.supabase
          .from("profiles")
          .update({ name: input.name, phone: input.phone })
          .eq("id", ctx.userId)
          .select("*")
          .maybeSingle();
        if (error) throw new HttpError(error.message, 400);
        if (!data) throw new HttpError("Profile not found", 404);
        return data;
      }),
    },
  },
});
