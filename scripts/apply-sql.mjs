// Applies Usop's SQL migrations to a NEW, EMPTY Supabase project, in the only order that works:
//   1) supabase/migrations/*.sql  (base tables, created while the app lived on Lovable Cloud)
//   2) drizzle/migrations/*.sql   (security, money, guards, owner verification)
// Usage (PowerShell, from the project folder):
//   $env:DATABASE_URL = "postgresql://postgres.<ref>:<URL-encoded password>@<pooler host>:5432/postgres"
//   node scripts/apply-sql.mjs --dry     # list what would run
//   node scripts/apply-sql.mjs           # run it (asks you to type the host name to confirm)
// Already-applied files are remembered in public.usop_applied_migrations and skipped on re-runs.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import pg from "pg";

const args = new Set(process.argv.slice(2));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first (the Supabase connection string, with the password filled in).");
  process.exit(1);
}

const files = [
  ...readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort().map((f) => join("supabase/migrations", f)),
  ...readdirSync("drizzle/migrations").filter((f) => f.endsWith(".sql")).sort().map((f) => join("drizzle/migrations", f)),
];

let host;
try {
  host = new URL(url).hostname;
} catch {
  console.error("DATABASE_URL is not a valid URL. If your password has special characters (@ # / ? %), URL-encode them.");
  process.exit(1);
}

console.log(`Target database host: ${host}`);
console.log(`${files.length} migration files in order:`);
files.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. ${f}`));
if (args.has("--dry")) process.exit(0);

if (!args.has("--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nThis changes the database above. Type its host name (${host}) to continue: `);
  rl.close();
  if (answer.trim() !== host) {
    console.log("Host name did not match. Nothing was changed.");
    process.exit(1);
  }
}

const local = ["localhost", "127.0.0.1"].includes(host);
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
await client.connect();

await client.query(
  `CREATE TABLE IF NOT EXISTS public.usop_applied_migrations (file text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
);
const done = new Set((await client.query("SELECT file FROM public.usop_applied_migrations")).rows.map((r) => r.file));

if (done.size === 0) {
  const existing = await client.query("SELECT to_regclass('public.slots') AS t");
  if (existing.rows[0].t && !args.has("--force")) {
    console.error("public.slots already exists but no migrations are recorded: this is not a fresh project. Stopping.");
    console.error("Use a new empty Supabase project (or pass --force if you are sure).");
    await client.end();
    process.exit(1);
  }
}

for (const f of files) {
  if (done.has(f)) {
    console.log(`skip  ${f}`);
    continue;
  }
  try {
    // One multi-statement query = one implicit transaction: a failing file changes nothing.
    await client.query(readFileSync(f, "utf8"));
    await client.query("INSERT INTO public.usop_applied_migrations (file) VALUES ($1)", [f]);
    console.log(`ok    ${f}`);
  } catch (e) {
    console.error(`FAIL  ${f}\n      ${e.message}${e.position ? ` (character ${e.position})` : ""}`);
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log("\nAll migrations applied.");
