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

// Get the existing user IDs
const { rows: ownerRows } = await c.query("select id from auth.users where email = $1", ["owner@usop.demo"]);
const { rows: driverRows } = await c.query("select id from auth.users where email = $1", ["driver@usop.demo"]);
const ownerId = ownerRows[0].id;
const driverId = driverRows[0].id;

// Clear out old failed slots just in case
await c.query("DELETE FROM public.slots WHERE owner_id = $1", [ownerId]);

console.log("Seeding slots...");
const slots = [
  { name: "MG Road Covered Parking", area: "MG Road, Bengaluru", lat: 12.9756, lng: 77.6068, rate: 50, instructions: "Enter via Gate 2. Show the app at reception. Slot B-14 on level 2." },
  { name: "Koramangala Basement Lot", area: "5th Block, Koramangala", lat: 12.9352, lng: 77.6245, rate: 40, instructions: "Ring bell at Gate A. Basement level B1, park in any yellow-marked bay." },
  { name: "Indiranagar Open Air", area: "100 Ft Rd, Indiranagar", lat: 12.9719, lng: 77.6412, rate: 35, instructions: "Open lot next to Cafe Coffee Day. Attendant will guide you." },
];

const slotIds = [];
for (const s of slots) {
  const { rows: newRows } = await c.query(
    `insert into public.slots (owner_id, name, approx_area, full_address, lat, lng,
       hourly_rate, daily_rate, monthly_rate, status, vehicle_type,
       vehicle_size_limit, access_instructions, photos, rating, covered, cctv, disabled_access,
       cancellation_policy, archived, slot_type, base_rate, is_available, approval_status, approved_at)
     values ($1,$2,$3,$3,$4,$5,$6::numeric,$6::numeric*8,$6::numeric*30,'open','car','Any',$7,
             array[]::text[], 4.6, true, true, false, 'moderate', false, 'standard_car', $6::numeric, true, 'pending', now())
     returning id`,
    [ownerId, s.name, s.area, s.lat, s.lng, s.rate, s.instructions]
  );
  slotIds.push(newRows[0].id);
}

console.log("Seeding reservations...");
// Past reservation (for Book Again)
await c.query(
  `insert into public.reservations
   (driver_id, slot_id, start_time, end_time, status, total_price, rate_type,
    vehicle_plate, grand_total, created_at, arrived_at)
   values ($1,$2, now() - interval '3 days', now() - interval '3 days' + interval '2 hours',
           'completed', 100, 'hourly', 'KA 01 AB 1234', 100, now() - interval '3 days',
           now() - interval '3 days' + interval '5 minutes')`,
  [driverId, slotIds[0]]
);

// Upcoming reservation (for "I'm Here")
await c.query(
  `insert into public.reservations
   (driver_id, slot_id, start_time, end_time, status, total_price, rate_type,
    vehicle_plate, grand_total, created_at)
   values ($1,$2, now() + interval '2 hours', now() + interval '4 hours',
           'upcoming', 100, 'hourly', 'KA 01 AB 1234', 100, now())`,
  [driverId, slotIds[1]]
);

console.log("Seeding notifications and reviews...");
// Notification for the owner
await c.query(
  `insert into public.notifications (user_id, type, title, body, link, read)
   values ($1, 'arrival', 'Driver arrived', 'Priya Sharma arrived at MG Road Covered Parking',
           '/reservations', false)`,
  [ownerId]
);

// A review
await c.query(
  `insert into public.reviews (slot_id, driver_id, rating, comment)
   values ($1, $2, 5, 'Great spot, easy to find. Will book again.')`,
  [slotIds[0], driverId]
);

console.log("✅ Demo data seeded successfully!");
console.log(`Owner login:  owner@usop.demo / Demo123!`);
console.log(`Driver login: driver@usop.demo / Demo123!`);

await c.end();