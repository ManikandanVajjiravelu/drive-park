import { describe, it, expect } from "vitest";
import {
  ARRIVE_EARLY_MINUTES,
  LATE_GRACE_MINUTES,
  canMarkArrived,
  canReportLate,
} from "@/lib/arrival-window";

const START = "2026-10-04T10:00:00Z";
const END = "2026-10-04T12:00:00Z";
const startMs = Date.parse(START);
const endMs = Date.parse(END);
const MIN = 60e3;

const booking = {
  status: "upcoming",
  start_time: START,
  end_time: END,
  arrived_at: null,
  late_notified_at: null,
};

describe("canMarkArrived", () => {
  it("opens exactly ARRIVE_EARLY_MINUTES before the start", () => {
    expect(canMarkArrived(booking, startMs - ARRIVE_EARLY_MINUTES * MIN)).toBe(true);
  });

  it("is closed one minute too early", () => {
    expect(canMarkArrived(booking, startMs - (ARRIVE_EARLY_MINUTES + 1) * MIN)).toBe(false);
  });

  it("is open during the booking, up to and including the end time", () => {
    expect(canMarkArrived(booking, startMs)).toBe(true);
    expect(canMarkArrived(booking, endMs - MIN)).toBe(true);
    expect(canMarkArrived(booking, endMs)).toBe(true);
  });

  it("closes after the end time", () => {
    expect(canMarkArrived(booking, endMs + 1)).toBe(false);
  });

  it("is closed once the driver has already arrived", () => {
    expect(canMarkArrived({ ...booking, arrived_at: START }, startMs)).toBe(false);
  });

  it("is closed for completed or cancelled bookings", () => {
    expect(canMarkArrived({ ...booking, status: "completed" }, startMs)).toBe(false);
    expect(canMarkArrived({ ...booking, status: "cancelled" }, startMs)).toBe(false);
  });

  it("is open for an active booking (session already started)", () => {
    expect(canMarkArrived({ ...booking, status: "active" }, startMs + 10 * MIN)).toBe(true);
  });

  it("is closed for unparseable timestamps", () => {
    expect(canMarkArrived({ ...booking, start_time: "nope" }, startMs)).toBe(false);
  });
});

describe("canReportLate", () => {
  it("is open before the start time", () => {
    expect(canReportLate(booking, startMs - 60 * MIN)).toBe(true);
  });

  it("is open up to LATE_GRACE_MINUTES after the start, exclusive", () => {
    expect(canReportLate(booking, startMs + LATE_GRACE_MINUTES * MIN - 1)).toBe(true);
    expect(canReportLate(booking, startMs + LATE_GRACE_MINUTES * MIN)).toBe(false);
  });

  it("is closed once reported", () => {
    expect(canReportLate({ ...booking, late_notified_at: START }, startMs - MIN)).toBe(false);
  });

  it("is closed for an active booking", () => {
    expect(canReportLate({ ...booking, status: "active" }, startMs - MIN)).toBe(false);
  });

  it("is closed for unparseable start times", () => {
    expect(canReportLate({ ...booking, start_time: "nope" }, startMs)).toBe(false);
  });
});