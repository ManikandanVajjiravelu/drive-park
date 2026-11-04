import { describe, it, expect } from "vitest";
import { createBookingSchema } from "../src/lib/bookings.schema";
import {
  quoteFromData,
  sortResults,
  FULL_FLAG_WINDOW_HOURS,
  isFullGateActive,
  type QuoteData,
  type QuoteSlot,
} from "../src/lib/quote";
import { quoteWindow } from "../src/lib/bookings.server";
import { searchWindow, fetchAllPages } from "../src/lib/search.server";

const ist = (s: string) => new Date(`${s}+05:30`);
const NOW = ist("2026-06-09T10:00:00"); // Tuesday
const H = 3600e3;
// Coordinates only exist on the raw rows the quote never sees, so they are test-only extras.
type SlotOverride = Partial<QuoteSlot> & {
  lat?: number;
  lng?: number;
  public_lat?: number;
  public_lng?: number;
};
const slot = (id: string, extra: SlotOverride = {}) => ({
  id,
  owner_id: "owner",
  status: "open",
  archived: false,
  is_available: true,
  approval_status: "approved",
  slot_type: "standard_car",
  lot_id: null,
  hourly_rate: 40,
  daily_rate: 300,
  monthly_rate: 5000,
  lat: 13.05,
  lng: 80.24,
  public_lat: 13.051,
  public_lng: 80.241,
  ...extra,
});
const empty: QuoteData = { hours: [], reservations: [], holidays: [], demand: null };
const q = (s: QuoteSlot, start: Date, hours = 2, data = empty) =>
  quoteFromData(s, { startTime: start, duration: hours, rateType: "hourly" }, data, NOW);
const res = (slot_id: string, s: Date, e: Date, extra = {}) => ({
  slot_id,
  status: "upcoming",
  start_time: s.toISOString(),
  end_time: e.toISOString(),
  payment_expires_at: null as string | null,
  ...extra,
});

describe("schema durations", () => {
  const base = { slotId: crypto.randomUUID(), startTime: NOW.toISOString() };
  const ok = (rateType: string, duration: number) =>
    createBookingSchema.safeParse({ ...base, rateType, duration }).success;
  it("hourly 0.5 and 2.5 accepted, 25 rejected", () => {
    expect(ok("hourly", 0.5)).toBe(true);
    expect(ok("hourly", 2.5)).toBe(true);
    expect(ok("hourly", 24)).toBe(true);
    expect(ok("hourly", 25)).toBe(false);
    expect(ok("hourly", 1.25)).toBe(false);
  });
  it("daily whole 1–30, monthly 1–12", () => {
    expect(ok("daily", 1.5)).toBe(false);
    expect(ok("daily", 30)).toBe(true);
    expect(ok("daily", 31)).toBe(false);
    expect(ok("monthly", 12)).toBe(true);
    expect(ok("monthly", 13)).toBe(false);
  });
});

describe("window quote", () => {
  it("available", () => {
    const r = q(slot("a"), ist("2026-06-09T11:00:00"));
    expect(r.reason).toBe("ok");
    expect(r.grandTotal).toBeGreaterThan(0);
  });
  it("booked by an overlapping reservation", () => {
    const r = q(slot("a"), ist("2026-06-09T11:00:00"), 2, {
      ...empty,
      reservations: [res("a", ist("2026-06-09T12:00:00"), ist("2026-06-09T14:00:00"))],
    });
    expect(r.reason).toBe("booked");
  });
  it("an expired unpaid hold or cancelled booking counts as free", () => {
    const r = q(slot("a"), ist("2026-06-09T11:00:00"), 2, {
      ...empty,
      reservations: [
        res("a", ist("2026-06-09T11:00:00"), ist("2026-06-09T13:00:00"), {
          payment_expires_at: ist("2026-06-09T09:50:00").toISOString(),
        }),
        res("a", ist("2026-06-09T11:00:00"), ist("2026-06-09T13:00:00"), { status: "cancelled" }),
      ],
    });
    expect(r.reason).toBe("ok");
  });
  it("closed by opening hours (IST)", () => {
    const hours = [
      {
        id: "h",
        slot_id: "a",
        weekday: 2,
        open_time: "09:00:00",
        close_time: "12:00:00",
        closed: false,
      },
    ];
    expect(q(slot("a"), ist("2026-06-09T11:00:00"), 2, { ...empty, hours }).reason).toBe("closed");
    expect(q(slot("a"), ist("2026-06-09T10:00:00"), 2, { ...empty, hours }).reason).toBe("ok");
  });
  it("past start (5 min grace)", () => {
    expect(q(slot("a"), new Date(NOW.getTime() - 4 * 60e3)).reason).toBe("ok");
    expect(q(slot("a"), new Date(NOW.getTime() - 6 * 60e3)).reason).toBe("past");
  });
  it(`full flag blocks only starts within ${FULL_FLAG_WINDOW_HOURS} h`, () => {
    const full = slot("a", { status: "full" });
    expect(q(full, new Date(NOW.getTime() + 2 * H - 60e3)).reason).toBe("unavailable");
    expect(q(full, new Date(NOW.getTime() + 2 * H)).reason).toBe("ok");
  });
  it("sort: available first, then by mode", () => {
    const items = [
      { id: "x", available: false, distance: 0.1, price: 10, rating: 5 },
      { id: "y", available: true, distance: 3, price: 50, rating: 4 },
      { id: "z", available: true, distance: 1, price: 90, rating: 3 },
    ];
    expect(sortResults(items, "distance").map((i) => i.id)).toEqual(["z", "y", "x"]);
    expect(sortResults(items, "price").map((i) => i.id)).toEqual(["y", "z", "x"]);
    expect(sortResults(items, "rating").map((i) => i.id)).toEqual(["y", "z", "x"]);
  });
});

function fakeDb(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])] as Record<string, unknown>[];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "neq", "lt", "gt", "gte", "lte", "limit", "order"]) q[m] = () => q;
      q.eq = (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q);
      q.in = (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q);
      q.range = async (f: number, t: number) => ({ data: rows.slice(f, t + 1) });
      q.maybeSingle = async () => ({ data: rows[0] ?? null });
      q.then = (r: (v: { data: unknown[] }) => unknown) => r({ data: rows });
      return q;
    },
  };
}

describe("search quote equals booking quote", () => {
  // 6 slots within 1 km so dynamic demand applies; some booked.
  const slots = ["a", "b", "c", "d", "e", "f"].map((id, i) =>
    slot(id, { lat: 13.05 + i * 0.001, hourly_rate: 30 + i * 5 }),
  );
  const start = ist("2026-06-09T17:30:00");
  const db = fakeDb({
    slots,
    slot_availability: [],
    reservations: [
      res("b", ist("2026-06-09T17:00:00"), ist("2026-06-09T19:00:00")),
      res("c", ist("2026-06-09T18:00:00"), ist("2026-06-09T20:00:00")),
    ],
    public_holidays: [{ date: "2026-06-10" }],
    parking_lots: [],
  });
  for (const [rateType, duration] of [
    ["hourly", 2.5],
    ["daily", 2],
    ["monthly", 1],
  ] as const) {
    it(rateType, async () => {
      const found = await searchWindow(
        db,
        { startTime: start.toISOString(), duration, rateType, lat: 13.05, lng: 80.24 },
        NOW,
      );
      expect(found).toHaveLength(6);
      for (const s of slots) {
        const booking = await quoteWindow(
          db as never,
          s,
          { startTime: start, duration, rateType },
          NOW,
        );
        const r = found.find((f) => f.slotId === s.id)!;
        expect(r.totalPrice).toBe(booking.grandTotal);
        expect(r.available).toBe(booking.available);
        expect(r.reason).toBe(booking.reason);
        expect(JSON.stringify(r)).not.toMatch(/"lat"|"lng"|address/);
      }
      expect(found.find((f) => f.slotId === "b")!.reason).toBe("booked");
    });
  }
});

describe("search returns nearest slots", () => {
  it("with 150 slots, the 100 nearest are returned in distance order", async () => {
    // Ids sorted opposite to distance so id order would pick the farthest.
    const slots = Array.from({ length: 150 }, (_, i) => {
      const lat = 13.05 + i * 0.0005;
      return slot(`s${String(149 - i).padStart(3, "0")}`, { lat, public_lat: lat, public_lng: 80.24 });
    });
    const db = fakeDb({ slots, slot_availability: [], reservations: [], public_holidays: [], parking_lots: [] });
    const found = await searchWindow(
      db,
      { startTime: ist("2026-06-09T12:00:00").toISOString(), duration: 1, rateType: "hourly", lat: 13.05, lng: 80.24 },
      NOW,
    );
    expect(found).toHaveLength(100);
    expect(found[0].slotId).toBe("s149");
    expect(found[99].slotId).toBe("s050");
    const d = found.map((f) => f.approxDistanceKm!);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });
});

describe("full gate (slot page)", () => {
  it(`active only for starts within ${FULL_FLAG_WINDOW_HOURS} h`, () => {
    expect(isFullGateActive("full", new Date(NOW.getTime() + 2 * H - 60e3), NOW)).toBe(true);
    expect(isFullGateActive("full", new Date(NOW.getTime() + 2 * H), NOW)).toBe(false);
    expect(isFullGateActive("full", new Date(NOW.getTime() + 2 * H + 60e3), NOW)).toBe(false);
    expect(isFullGateActive("open", NOW, NOW)).toBe(false);
    expect(isFullGateActive("full", new Date("nope"), NOW)).toBe(true);
  });
});

describe("fetchAllPages", () => {
  it("reads 2500 rows in pages of 1000", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const calls: [number, number][] = [];
    const rows = await fetchAllPages(() => ({
      range: async (f: number, t: number) => (calls.push([f, t]), { data: all.slice(f, t + 1) }),
    }));
    expect(rows).toHaveLength(2500);
    expect(rows.map((r) => r.id)).toEqual(all.map((r) => r.id));
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
  it("throws on error", async () => {
    await expect(
      fetchAllPages(() => ({ range: async () => ({ data: null, error: new Error("x") }) })),
    ).rejects.toThrow("x");
  });
});
