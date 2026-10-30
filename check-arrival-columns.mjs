import { Client } from "pg";

const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await c.connect();

const want = ["arrived_at", "late_notified_at"];
const gone = ["arrived_lat", "arrived_lng"];
const r = await c.query(
  "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'reservations'",
);

const found = r.rows.map((x) => x.column_name);
const missing = want.filter((w) => !found.includes(w));
const left = gone.filter((g) => found.includes(g));

console.log("found:  ", want.filter((w) => found.includes(w)).join(", ") || "(none)");
console.log("missing:", missing.join(", ") || "(none)");
console.log("coords: ", left.length === 0 ? "arrived_lat/arrived_lng dropped (good)" : `${left.join(", ")} still present`);

await c.end();

process.exit(missing.length === 0 && left.length === 0 ? 0 : 1);