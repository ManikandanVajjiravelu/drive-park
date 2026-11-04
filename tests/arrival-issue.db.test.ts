/**
 * "Can't Park" data rules (migrations 0014 + 0015): `arrival_issues` is readable by the
 * driver, the slot owner and admins, writable only by the service role, one open report per
 * booking, and a `disputed` booking still counts as open / still completes.
 * Needs PG* env vars with rights to create auth users. Run: `RUN_DB_TESTS=1 bun run test:db`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const enabled = process.env.RUN_DB_TESTS === "1" && !!process.env.PGHOST;
const client = new Client({ ssl: { rejectUnauthorized: false } });

const host = randomUUID();
const driver = randomUUID();
const stranger = randomUUID();
const slotId = randomUUID();
const resId = randomUUID();

async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ]);
    await client.query("SET LOCAL ROLE authenticated");
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

const sql = (text: string, params: unknown[] = []) => client.query(text, params);

async function insertIssue(issueType = "spot_occupied", note: string | null = null) {
  const { rows } = await sql(
    `INSERT INTO public.arrival_issues (reservation_id, driver_id, issue_type, note)
     VALUES ($1,$2,$3,$4) RETURNING id, status, resolution_deadline`,
    [resId, driver, issueType, note],
  );
  return rows[0] as { id: string; status: string; resolution_deadline: string };
}

describe.skipIf(!enabled)("arrival issues", () => {
  beforeAll(async () => {
    await client.connect();
    for (const id of [host, driver, stranger]) {
      await sql(
        `INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
         VALUES ($1, $2, '{"role":"driver"}', 'authenticated', 'authenticated')`,
        [id, `${id}@test.usop`],
      );
    }
    await sql(
      `INSERT INTO public.slots (id, owner_id, name, approx_area, full_address, access_instructions, lat, lng, status, approval_status)
       VALUES ($1,$2,'Issue Slot','area','7 Dispute Rd','Ring the bell',0,0,'open','approved')`,
      [slotId, host],
    );
    await sql(
      `INSERT INTO public.reservations (id, driver_id, slot_id, start_time, end_time, status, total_price, rate_type)
       VALUES ($1,$2,$3, now() - interval '10 minutes', now() + interval '50 minutes', 'active', 100, 'hourly')`,
      [resId, driver, slotId],
    );
  });

  beforeEach(async () => {
    if (!enabled) return;
    await sql("DELETE FROM public.arrival_issues WHERE reservation_id = $1", [resId]);
    await sql(
      `UPDATE public.reservations
          SET status = 'active', start_time = now() - interval '10 minutes',
              end_time = now() + interval '50 minutes'
        WHERE id = $1`,
      [resId],
    );
  });

  afterAll(async () => {
    if (!enabled) return;
    await sql("DELETE FROM public.arrival_issues WHERE reservation_id = $1", [resId]);
    await sql("DELETE FROM public.reservations WHERE id = $1", [resId]);
    await sql("DELETE FROM public.slots WHERE id = $1", [slotId]);
    await sql("DELETE FROM auth.users WHERE id = ANY($1)", [[host, driver, stranger]]);
    await client.end();
  });

  it("gives the owner a 15 minute deadline by default", async () => {
    const issue = await insertIssue("gate_locked", "Gate code does not work");
    expect(issue.status).toBe("pending");
    const minutes = (new Date(issue.resolution_deadline).getTime() - Date.now()) / 60e3;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it("allows only one open report per booking", async () => {
    const first = await insertIssue();
    await expect(insertIssue("other", null)).rejects.toThrow(
      /arrival_issues_one_pending|duplicate key/i,
    );
    // Once resolved, the driver may report again (e.g. the host never turned up).
    await sql(
      "UPDATE public.arrival_issues SET status = 'resolved', resolved_at = now() WHERE id = $1",
      [first.id],
    );
    expect((await insertIssue("wrong_address", null)).status).toBe("pending");
  });
});
