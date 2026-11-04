import { describe, it, expect } from "vitest";
import {
  ARRIVE_EARLY_MINUTES,
  ISSUE_RESOLUTION_MINUTES,
  LATE_GRACE_MINUTES,
  PARKING_ISSUE_LABELS,
  PARKING_ISSUE_TYPES,
  PARKING_NOTE_MAX,
  canEditParkingNote,
  canMarkArrived,
  canReportLate,
  canReportParkingIssue,
  normalizeParkingNote,
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

describe("canReportParkingIssue", () => {
  const active = { status: "active", end_time: END };

  it("is open during an active session", () => {
    expect(canReportParkingIssue(active, startMs)).toBe(true);
    expect(canReportParkingIssue(active, startMs + 30 * MIN)).toBe(true);
  });

  it("is open up to and including the end time", () => {
    expect(canReportParkingIssue(active, endMs)).toBe(true);
    expect(canReportParkingIssue(active, endMs + 1)).toBe(false);
  });

  it("is closed before the session starts", () => {
    expect(canReportParkingIssue({ status: "upcoming", end_time: END }, startMs - MIN)).toBe(false);
  });

  it("is closed for completed, cancelled and disputed bookings", () => {
    expect(canReportParkingIssue({ status: "completed", end_time: END }, startMs)).toBe(false);
    expect(canReportParkingIssue({ status: "cancelled", end_time: END }, startMs)).toBe(false);
    expect(canReportParkingIssue({ status: "disputed", end_time: END }, startMs)).toBe(false);
  });

  it("is closed while a report is already open", () => {
    expect(canReportParkingIssue({ ...active, pending_issue: true }, startMs)).toBe(false);
  });

  it("allows a second report once the first one is closed", () => {
    expect(canReportParkingIssue({ ...active, pending_issue: false }, startMs)).toBe(true);
  });

  it("is closed for unparseable end times", () => {
    expect(canReportParkingIssue({ status: "active", end_time: "nope" }, startMs)).toBe(false);
  });
});

describe("parking issue reasons", () => {
  it("offers a label for every allowed reason", () => {
    for (const t of PARKING_ISSUE_TYPES) expect(PARKING_ISSUE_LABELS[t]).toBeTruthy();
    expect(Object.keys(PARKING_ISSUE_LABELS).sort()).toEqual([...PARKING_ISSUE_TYPES].sort());
  });

  it("promises the owner a 15 minute window", () => {
    expect(ISSUE_RESOLUTION_MINUTES).toBe(15);
  });
});

describe("canEditParkingNote", () => {
  const active = { status: "active", end_time: END };

  it("is open during the session, including the last minute", () => {
    expect(canEditParkingNote(active, startMs)).toBe(true);
    expect(canEditParkingNote(active, endMs)).toBe(true);
  });

  it("closes once the end time has passed", () => {
    expect(canEditParkingNote(active, endMs + 1)).toBe(false);
  });

  it("is open before the start, so a driver can save it on the way", () => {
    expect(canEditParkingNote({ status: "upcoming", end_time: END }, startMs - 120 * MIN)).toBe(
      true,
    );
  });

  it("stays open on a disputed booking (the driver is still in the garage)", () => {
    expect(canEditParkingNote({ status: "disputed", end_time: END }, startMs)).toBe(true);
  });

  it("is closed for completed, cancelled and unknown statuses", () => {
    expect(canEditParkingNote({ status: "completed", end_time: END }, startMs)).toBe(false);
    expect(canEditParkingNote({ status: "cancelled", end_time: END }, startMs)).toBe(false);
    expect(canEditParkingNote({ status: "refunded", end_time: END }, startMs)).toBe(false);
  });

  it("is closed for unparseable end times", () => {
    expect(canEditParkingNote({ status: "active", end_time: "nope" }, startMs)).toBe(false);
  });
});

describe("normalizeParkingNote", () => {
  it("keeps a normal note and trims the edges", () => {
    expect(normalizeParkingNote("  Level B2, Pillar 14 ")).toBe("Level B2, Pillar 14");
  });

  it("turns missing, empty and whitespace-only notes into null (clears the column)", () => {
    expect(normalizeParkingNote(undefined)).toBeNull();
    expect(normalizeParkingNote(null)).toBeNull();
    expect(normalizeParkingNote("")).toBeNull();
    expect(normalizeParkingNote("   \n\t ")).toBeNull();
  });

  it("caps the note at PARKING_NOTE_MAX, the same limit the database check enforces", () => {
    const long = "x".repeat(PARKING_NOTE_MAX + 40);
    expect(normalizeParkingNote(long)).toHaveLength(PARKING_NOTE_MAX);
    expect(PARKING_NOTE_MAX).toBe(120);
  });
});
