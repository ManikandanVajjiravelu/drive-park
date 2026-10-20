import { createFileRoute } from "@tanstack/react-router";
import { handle, options, HttpError } from "@/lib/api-auth";
import { vehiclesActionSchema } from "@/lib/mobile.schema";

export const Route = createFileRoute("/api/public/vehicles/")({
  server: {
    handlers: {
      OPTIONS: options,
      GET: handle(async ({ ctx }) => {
        const { data, error } = await ctx.supabase
          .from("vehicles")
          .select("*")
          .eq("user_id", ctx.userId)
          .order("created_at", { ascending: false });
        if (error) throw new HttpError(error.message, 500);
        return data ?? [];
      }),
      POST: handle(async ({ ctx, body }) => {
        const input = vehiclesActionSchema.parse(body);

        if (input.action === "create") {
          const { count, error: countErr } = await ctx.supabase
            .from("vehicles")
            .select("id", { count: "exact", head: true })
            .eq("user_id", ctx.userId);
          if (countErr) throw new HttpError(countErr.message, 500);
          const isFirst = (count ?? 0) === 0;
          const { data, error } = await ctx.supabase
            .from("vehicles")
            .insert({
              user_id: ctx.userId,
              plate: input.plate,
              make: input.make,
              colour: input.colour,
              is_default: input.is_default ?? isFirst,
            })
            .select("*")
            .single();
          if (error) throw new HttpError(error.message, 400);
          return data;
        }

        if (input.action === "delete") {
          const { data, error } = await ctx.supabase
            .from("vehicles")
            .delete()
            .eq("id", input.id)
            .eq("user_id", ctx.userId)
            .select("id")
            .maybeSingle();
          if (error) throw new HttpError(error.message, 400);
          if (!data) throw new HttpError("Vehicle not found", 404);
          return { deleted: true, id: data.id };
        }

        // set_default
        const { data: target, error: findErr } = await ctx.supabase
          .from("vehicles")
          .select("id")
          .eq("id", input.id)
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (findErr) throw new HttpError(findErr.message, 500);
        if (!target) throw new HttpError("Vehicle not found", 404);

        const { error: clearErr } = await ctx.supabase
          .from("vehicles")
          .update({ is_default: false })
          .eq("user_id", ctx.userId);
        if (clearErr) throw new HttpError(clearErr.message, 500);

        const { data, error } = await ctx.supabase
          .from("vehicles")
          .update({ is_default: true })
          .eq("id", input.id)
          .eq("user_id", ctx.userId)
          .select("*")
          .single();
        if (error) throw new HttpError(error.message, 400);
        return data;
      }),
    },
  },
});
