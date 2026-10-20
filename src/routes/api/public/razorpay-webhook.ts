import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const eventSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({
      entity: z.object({ id: z.string(), order_id: z.string().nullable().optional(), status: z.string(), amount: z.number().optional(), currency: z.string().optional() }).passthrough(),
    }).optional(),
    order: z.object({ entity: z.object({ id: z.string() }).passthrough() }).optional(),
    refund: z.object({ entity: z.object({ id: z.string(), payment_id: z.string(), status: z.string().optional() }).passthrough() }).optional(),
  }).passthrough(),
});

// Exempt from per-user rate limits: authenticated by HMAC signature instead.
export const Route = createFileRoute("/api/public/razorpay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["RAZORPAY_WEBHOOK_SECRET"];
        if (!secret) return new Response("Webhook not configured", { status: 503 });

        const raw = await request.text();
        const sig = request.headers.get("x-razorpay-signature") ?? "";
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Invalid signature", { status: 401 });

        let parsed;
        try {
          parsed = eventSchema.parse(JSON.parse(raw));
        } catch {
          return new Response("Bad payload", { status: 400 });
        }
        const { event, payload } = parsed;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Replay protection: Razorpay sends a unique id per event delivery.
        const eventId = request.headers.get("x-razorpay-event-id") ??
          createHmac("sha256", "evt").update(raw).digest("hex");
        const { error: dupErr } = await supabaseAdmin.from("webhook_events").insert({ event_id: eventId, event });
        if (dupErr) {
          if (dupErr.code === "23505") return new Response("ok"); // already processed
          console.error("webhook_events insert failed", dupErr);
          return new Response("retry", { status: 500 });
        }

        const svc = await import("@/lib/payments.server");
        try {
          if (event === "refund.processed" || event === "refund.failed") {
            const rf = payload.refund?.entity;
            if (rf) await svc.markRefund(rf.id, event === "refund.processed" ? "processed" : "failed");
            return new Response("ok");
          }
          if (event === "payment.captured" || event === "payment.authorized" || event === "payment.failed" || event === "order.paid") {
            const pay = payload.payment?.entity;
            const orderId = pay?.order_id ?? payload.order?.entity.id ?? null;
            if (!pay || !orderId) return new Response("ok");
            const { data: row } = await supabaseAdmin.from("payments").select("id").eq("razorpay_order_id", orderId).maybeSingle();
            if (!row) return new Response("ok"); // not our order
            await svc.settlePayment(row.id, { ...pay, order_id: orderId });
            return new Response("ok");
          }
          return new Response("ignored");
        } catch (e) {
          // Let Razorpay retry: forget this event id so the redelivery is processed.
          await supabaseAdmin.from("webhook_events").delete().eq("event_id", eventId);
          console.error("webhook failed", e);
          return new Response("retry", { status: 500 });
        }
      },
    },
  },
});
