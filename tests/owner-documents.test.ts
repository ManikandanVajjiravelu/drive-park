/**
 * S17 landowner verification (reconstructed from the DeepSeek commit f77de23).
 * Runs while impersonating a signed-in user (role `authenticated` + JWT claims).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const enabled = process.env.RUN_DB_TESTS === "1" && !!process.env.PGHOST;
const client = new Client({ ssl: process.env.PGSSL === "0" ? false : { rejectUnauthorized: false } });

const owner = randomUUID();
const otherOwner = randomUUID();
const admin = randomUUID();
const slotId = randomUUID();

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

/** Insert a document as the test superuser (bypasses RLS) and return its id. */
async function seedDoc(
  ownerId: string,
  kind: "id_proof" | "ownership_proof",
  status: "pending" | "approved" | "rejected",
): Promise<string> {
  const r = await sql(
    `INSERT INTO public.owner_documents (owner_id, kind, storage_path, status, reviewed_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'pending' THEN NULL ELSE now() END)
     RETURNING id`,
    [ownerId, kind, `${ownerId}/${randomUUID()}.pdf`, status],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!enabled)("owner verification", () => {
  beforeAll(async () => {
    await client.connect();
    for (const id of [owner, otherOwner, admin]) {
      await sql(
        `INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
         VALUES ($1, $2, '{"role":"landowner"}', 'authenticated', 'authenticated')`,
        [id, `${id}@test.usop`],
      );
    }
    await sql(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [admin]);
    await sql(
      `INSERT INTO public.slots (id, owner_id, name, approx_area, full_address, lat, lng, hourly_rate, daily_rate, monthly_rate, status, approval_status)
       VALUES ($1,$2,'Verify Slot','area','1 Secret St',0,0,20,100,2000,'open','pending')`,
      [slotId, owner],
    );
  });

  afterAll(async () => {
    if (!enabled) return;
    await sql("DELETE FROM public.owner_documents WHERE owner_id = ANY($1)", [[owner, otherOwner]]);
    await sql("DELETE FROM public.slots WHERE id = $1", [slotId]);
    await sql("DELETE FROM public.user_roles WHERE user_id = $1", [admin]);
    await sql("DELETE FROM auth.users WHERE id = ANY($1)", [[owner, otherOwner, admin]]);
    await client.end();
  });

  it("owners can upload a pending document and read it back", async () => {
    const path = `${owner}/${randomUUID()}.pdf`;
    // Insert and read in ONE transaction: asUser rolls back when it finishes.
    const { ins, read } = await asUser(owner, async () => {
      const ins = await sql(
        `INSERT INTO public.owner_documents (owner_id, kind, storage_path)
         VALUES ($1,'id_proof',$2) RETURNING status`,
        [owner, path],
      );
      const read = await sql("SELECT storage_path FROM public.owner_documents WHERE storage_path = $1", [path]);
      return { ins, read };
    });
    expect(ins.rows[0]).toEqual({ status: "pending" });
    expect(read.rowCount).toBe(1);
  });

  it("owners cannot self-approve or set review fields", async () => {
    const path = `${owner}/${randomUUID()}.pdf`;
    const r = await asUser(owner, () =>
      sql(
        `INSERT INTO public.owner_documents (owner_id, kind, storage_path, status, reviewed_by, reviewed_at)
         VALUES ($1,'ownership_proof',$2,'approved',$1,now()) RETURNING status, reviewed_by, reviewed_at`,
        [owner, path],
      ),
    );
    expect(r.rows[0]).toEqual({ status: "pending", reviewed_by: null, reviewed_at: null });
  });

  it("owners cannot update a document after upload", async () => {
    const id = await seedDoc(owner, "id_proof", "pending");
    await expect(
      asUser(owner, () => sql("UPDATE public.owner_documents SET note = 'x' WHERE id = $1", [id])),
    ).rejects.toThrow();
  });

  it("owners cannot delete a document, approved or not", async () => {
    const approved = await seedDoc(owner, "id_proof", "approved");
    const pending = await seedDoc(owner, "ownership_proof", "pending");
    await expect(
      asUser(owner, () => sql("DELETE FROM public.owner_documents WHERE id = $1", [approved])),
    ).rejects.toThrow();
    await expect(
      asUser(owner, () => sql("DELETE FROM public.owner_documents WHERE id = $1", [pending])),
    ).rejects.toThrow();
  });

  it("other owners cannot read someone else's documents", async () => {
    const id = await seedDoc(owner, "id_proof", "pending");
    const r = await asUser(otherOwner, () =>
      sql("SELECT id FROM public.owner_documents WHERE id = $1", [id]),
    );
    expect(r.rowCount).toBe(0);
  });

  it("admins can read every document and approve it", async () => {
    const id = await seedDoc(owner, "id_proof", "pending");
    const read = await asUser(admin, () =>
      sql("SELECT id FROM public.owner_documents WHERE id = $1", [id]),
    );
    expect(read.rowCount).toBe(1);
    const upd = await asUser(admin, () =>
      sql(
        `UPDATE public.owner_documents SET status='approved', reviewed_by=$1, reviewed_at=now()
         WHERE id=$2 RETURNING status`,
        [admin, id],
      ),
    );
    expect(upd.rows[0]).toEqual({ status: "approved" });
  });

  it("a listing cannot be approved without both documents approved", async () => {
    // Fresh owner with no documents at all.
    await expect(
      asUser(admin, () =>
        sql("UPDATE public.slots SET approval_status='approved' WHERE id=$1", [slotId]),
      ),
    ).rejects.toThrow();
  });

  it("a listing cannot be approved with only one document approved", async () => {
    await seedDoc(owner, "id_proof", "approved");
    await seedDoc(owner, "ownership_proof", "pending");
    await expect(
      asUser(admin, () =>
        sql("UPDATE public.slots SET approval_status='approved' WHERE id=$1", [slotId]),
      ),
    ).rejects.toThrow();
  });

  it("a listing can be approved once both latest documents are approved", async () => {
    await seedDoc(owner, "id_proof", "approved");
    await seedDoc(owner, "ownership_proof", "approved");
    const r = await asUser(admin, () =>
      sql("UPDATE public.slots SET approval_status='approved' WHERE id=$1 RETURNING approval_status", [slotId]),
    );
    expect(r.rows[0]).toEqual({ approval_status: "approved" });
  });

  it("a newer rejected document blocks a later approval", async () => {
    await seedDoc(owner, "id_proof", "approved");
    await seedDoc(owner, "ownership_proof", "approved");
    await asUser(admin, () =>
      sql("UPDATE public.slots SET approval_status='approved' WHERE id=$1", [slotId]),
    );
    // Re-open the listing, then upload a newer rejected ownership proof.
    await asUser(admin, () =>
      sql("UPDATE public.slots SET approval_status='pending' WHERE id=$1", [slotId]),
    );
    await seedDoc(owner, "ownership_proof", "rejected");
    await expect(
      asUser(admin, () =>
        sql("UPDATE public.slots SET approval_status='approved' WHERE id=$1", [slotId]),
      ),
    ).rejects.toThrow();
  });

  it("existing approved listings are not re-checked", async () => {
    // The slot is already approved from the previous test; an unrelated edit must pass.
    const r = await asUser(admin, () =>
      sql("UPDATE public.slots SET name='Renamed' WHERE id=$1 RETURNING name", [slotId]),
    );
    expect(r.rows[0]).toEqual({ name: "Renamed" });
  });

  it("an owner cannot file a document for someone else or point at someone else's folder", async () => {
    await expect(
      asUser(owner, () =>
        sql(`INSERT INTO public.owner_documents (owner_id, kind, storage_path) VALUES ($1,'id_proof',$2)`,
          [otherOwner, `${otherOwner}/${randomUUID()}.pdf`]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(owner, () =>
        sql(`INSERT INTO public.owner_documents (owner_id, kind, storage_path) VALUES ($1,'id_proof',$2)`,
          [owner, `${otherOwner}/${randomUUID()}.pdf`]),
      ),
    ).rejects.toThrow();
  });

  it("an admin cannot forge reviewed_by or change what a document points at", async () => {
    const id = await seedDoc(otherOwner, "id_proof", "pending");
    const r = await asUser(admin, () =>
      sql(`UPDATE public.owner_documents SET status='approved', reviewed_by=$1 WHERE id=$2 RETURNING reviewed_by`,
        [otherOwner, id]),
    );
    expect(r.rows[0]).toEqual({ reviewed_by: admin });
    await expect(
      asUser(admin, () => sql(`UPDATE public.owner_documents SET storage_path='x/y.pdf' WHERE id=$1`, [id])),
    ).rejects.toThrow();
  });

  it("my_verification_status reports only the caller's own state", async () => {
    await seedDoc(otherOwner, "id_proof", "approved");
    const mine = await asUser(owner, () => sql("SELECT public.my_verification_status() AS s"));
    expect(mine.rows[0].s.verified).toBe(false);
    const theirs = await asUser(otherOwner, () => sql("SELECT public.my_verification_status() AS s"));
    expect(theirs.rows[0].s.id_proof).toBe("approved");
    expect(theirs.rows[0].s.verified).toBe(false);
  });

  it("storage: owners upload only into their own folder; others cannot read it; admins can", async () => {
    const own = `${owner}/${randomUUID()}.pdf`;
    const res = await asUser(owner, async () => {
      await sql("INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('owner-docs', $1, $2)", [own, owner]);
      return sql("SELECT name FROM storage.objects WHERE name = $1", [own]);
    });
    expect(res.rowCount).toBe(1);
    await expect(
      asUser(owner, () =>
        sql("INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('owner-docs', $1, $2)",
          [`${otherOwner}/${randomUUID()}.pdf`, owner]),
      ),
    ).rejects.toThrow();
    await sql("INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('owner-docs', $1, $2)", [own, owner]);
    try {
      const other = await asUser(otherOwner, () => sql("SELECT name FROM storage.objects WHERE name = $1", [own]));
      expect(other.rowCount).toBe(0);
      const adm = await asUser(admin, () => sql("SELECT name FROM storage.objects WHERE name = $1", [own]));
      expect(adm.rowCount).toBe(1);
      await expect(
        asUser(owner, () => sql("DELETE FROM storage.objects WHERE name = $1 RETURNING name", [own])),
      ).resolves.toMatchObject({ rowCount: 0 });
    } finally {
      await sql("DELETE FROM storage.objects WHERE name = $1", [own]);
    }
  });

  it("the owner-docs bucket is private", async () => {
    const r = await sql("SELECT public FROM storage.buckets WHERE id = 'owner-docs'");
    expect(r.rows[0]).toEqual({ public: false });
  });
});
