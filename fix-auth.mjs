import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";

// Load .env.local manually
try {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const envFile = fs.readFileSync(envPath, "utf8");
  envFile.split("\n").forEach(line => {
    const match = line.match(/^DATABASE_URL="?(.*?)"?$/);
    if (match) process.env.DATABASE_URL = match[1].replace(/"$/, "");
  });
} catch (e) { }

const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("Fixing auth identities and passwords...");

// 1. Insert the missing identities for GoTrue
await c.query(`
  INSERT INTO auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  )
  SELECT
    id, id, email, 'email',
    jsonb_build_object('sub', id::text, 'email', email),
    now(), now(), now()
  FROM auth.users
  WHERE email IN ('driver@usop.demo', 'owner@usop.demo')
  ON CONFLICT DO NOTHING;
`);

// 2. Force the password hash to use bcrypt (Supabase standard)
await c.query(`
  UPDATE auth.users 
  SET encrypted_password = crypt('Demo123!', gen_salt('bf'))
  WHERE email IN ('driver@usop.demo', 'owner@usop.demo');
`);

console.log("✅ Auth fixed! You can log in now.");
await c.end();