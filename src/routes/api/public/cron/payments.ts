import { createFileRoute } from "@tanstack/react-router";

// Scheduled payments maintenance: expire holds, retry refunds, reconcile stuck payments.
// Called by the database scheduler with `Authorization: Bearer <internal token>`.
export const Route = createFileRoute("/api/public/cron/payments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const header = request.headers.get("authorization") ?? "";
        const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: ok } = await supabaseAdmin.rpc("verify_internal_token", { _name: "payments_cron", _token: token });
        if (!ok) return new Response("Unauthorized", { status: 401 });
        const { runMaintenance } = await import("@/lib/payments.server");
        const out = await runMaintenance();
        return Response.json(out, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
