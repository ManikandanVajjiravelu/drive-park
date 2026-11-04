/**
 * Payment server logic with the database and Razorpay mocked (always runs; no network, no DB).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

type Op = { m: string; a: unknown[] };
type Call = { table: string; ops: Op[] };
const calls: Call[] = [];
let resolver: (c: Call) => unknown = () => ({ data: null, error: null });

/** The proxy answers every method name, so any chain call returns another chain. */
type Chain = { args: (a: unknown) => Chain } & Record<string, (...a: unknown[]) => Chain>;

function chain(table: string): Chain {
  const c: Call = { table, ops: [] };
  calls.push(c);
  const p: Record<string, unknown> = new Proxy({}, {
    get(_t, m: string) {
      if (m === "then") return (ok: (v: unknown) => void, bad: (e: unknown) => void) => Promise.resolve(resolver(c)).then(ok, bad);
      return (...a: unknown[]) => { c.ops.push({ m, a }); return p; };
    },
  });
  return p as Chain;
}
const fakeDb = {
  from: (t: string) => chain(t),
  rpc: (name: string, args: unknown) => chain(`rpc:${name}`).args(args),
};
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeDb }));

const has = (c: Call, m: string) => c.ops.some((o) => o.m === m);
const arg = (c: Call, m: string) => c.ops.find((o) => o.m === m)?.a[0] as Record<string, unknown>;

beforeEach(() => {
  calls.length = 0;
  process.env.RAZORPAY_KEY_ID = "rzp_test_x";
  process.env.RAZORPAY_KEY_SECRET = "secret";
  delete process.env.RAZORPAY_REFUNDS_ENABLED;
});

describe("processRefund", () => {
  it("a Razorpay failure leaves the refund queued for retry with backoff", async () => {
    resolver = (c) => {
      if (c.table === "refunds" && has(c, "maybeSingle"))
        return { data: { id: "rf1", payment_id: "p1", reservation_id: "r1", amount_paise: 5000, reason: "t", idempotency_key: "cancel:r1:p1", attempts: 0 }, error: null };
      if (c.table === "payments" && has(c, "single")) return { data: { razorpay_payment_id: "pay_1" }, error: null };
      return { data: [], error: null };
    };
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as never;
    const { processRefund } = await import("@/lib/payments.server");
    await processRefund("rf1");
    const updates = calls.filter((c) => c.table === "refunds" && has(c, "update")).map((c) => arg(c, "update"));
    expect(updates.at(-1)).toMatchObject({ status: "queued", attempts: 1, last_error: "timeout" });
    expect(updates.some((u) => u.status === "processed")).toBe(false);
  });

  it("does nothing (stays queued) when refunds are switched off", async () => {
    process.env.RAZORPAY_REFUNDS_ENABLED = "false";
    const { processRefund } = await import("@/lib/payments.server");
    await processRefund("rf1");
    expect(calls).toHaveLength(0);
  });
});

describe("razorpay webhook", () => {
  const post = async (body: string, sig: string, eventId = "evt_1") => {
    const { Route } = await import("@/routes/api/public/razorpay-webhook");
    const h = (Route.options.server as { handlers: { POST: (a: { request: Request }) => Promise<Response> } }).handlers.POST;
    return h({ request: new Request("http://x/api/public/razorpay-webhook", {
      method: "POST", body, headers: { "x-razorpay-signature": sig, "x-razorpay-event-id": eventId },
    }) });
  };
  const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", status: "captured", amount: 100 } } } });

  it("rejects a bad signature", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec";
    expect((await post(body, "bad")).status).toBe(401);
  });

  it("drops a replayed event without touching payments", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec";
    resolver = (c) => (c.table === "webhook_events" ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: null, error: null });
    const sig = createHmac("sha256", "whsec").update(body).digest("hex");
    const res = await post(body, sig);
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.table === "payments")).toBe(false);
  });
});
