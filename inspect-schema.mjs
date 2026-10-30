import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
for (const t of ['slots','reservations','payments','notifications']) {
  const r = await c.query(`select column_name,data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t]);
  console.log(`\n=== ${t} ===`);
  console.log(r.rows.map(x => `${x.column_name} : ${x.data_type}`).join('\n'));
}
await c.end();
