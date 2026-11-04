import { describe, it, expect } from "vitest";
import {
  DISPUTE_HOLD_HOURS,
  OWNER_WINDOW_COPY,
  adminCanResolve,
  disputeStage,
  isHeldOpen,
  isIssueOpen,
  issueLabel,
  ownerCanResolve,
  ownerMinutesLeft,
  refundDuePaise,
  reservationAfterResolve,
} from "@/lib/disputes-window";
import { ISSUE_RESOLUTION_MINUTES } from "@/lib/arrival-window";

const START = "2026-10-04T10:00:00Z";
const END = "2026-10-04T12:00:00Z";
const startMs = Date.parse(START);
const endMs = Date.parse(END);
const MIN = 60e3;
const HOUR = 3600e3;

const deadline = (ms: number) => new Date(ms).toISOString();

const openIssue = (at: number) => ({ status: "pending", resolution_deadline: deadline(at) });
const booking = { status: "disputed", end_time: END };

describe("ownerCanResolve", () => {
  it("lets the owner resolve inside their window", () => {
    expect(ownerCanResolve(openIssue(startMs + 15 * MIN), startMs)).toBe(true);
  });

  it("still allows it on the exact deadline", () => {
    expect(ownerCanResolve(openIssue(startMs + 15 * MIN), startMs + 15 * MIN)).toBe(true);
  });

  it("hands the dispute to Usop one millisecond after the deadline", () => {
    expect(ownerCanResolve(openIssue(startMs + 15 * MIN), startMs + 15 * MIN + 1)).toBe(false);
  });

  it("refuses an already closed report", () => {
    const at = deadline(startMs + 15 * MIN);
    expect(ownerCanResolve({ status: "resolved", resolution_deadline: at }, startMs)).toBe(false);
    expect(ownerCanResolve({ status: "rejected", resolution_deadline: at }, startMs)).toBe(false);
  });

  it("refuses an unparseable deadline", () => {
    expect(ownerCanResolve({ status: "pending", resolution_deadline: "nonsense" }, startMs)).toBe(
      false,
    );
  });
});

describe("adminCanResolve", () => {
  it("only needs the report to be open, no deadline", () => {
    expect(adminCanResolve({ status: "pending" })).toBe(true);
    expect(adminCanResolve({ status: "resolved" })).toBe(false);
    expect(adminCanResolve({ status: "rejected" })).toBe(false);
  });

  it("agrees with isIssueOpen", () => {
    expect(isIssueOpen({ status: "pending" })).toBe(true);
    expect(isIssueOpen({ status: "resolved" })).toBe(false);
  });
});

describe("reservationAfterResolve", () => {
  it("cancels the booking when the driver is refunded", () => {
    expect(reservationAfterResolve(booking, "refund", startMs)).toBe("cancelled");
  });

  it("returns an ongoing session to active when the owner fixes it", () => {
    expect(reservationAfterResolve(booking, "remediate", startMs)).toBe("active");
    expect(reservationAfterResolve(booking, "reject", startMs)).toBe("active");
  });

  it("completes instead of resurrecting a session that already ended", () => {
    expect(reservationAfterResolve(booking, "remediate", endMs + 1)).toBe("completed");
    expect(reservationAfterResolve(booking, "reject", endMs + 1)).toBe("completed");
  });

  it("falls back to completed when the end time is unusable", () => {
    expect(reservationAfterResolve({ status: "disputed", end_time: "nope" }, "remediate")).toBe(
      "completed",
    );
  });
});

describe("refundDuePaise", () => {
  it("returns everything captured and not yet refunded", () => {
    const payments = [
      { amount_paise: 10_000, status: "captured" },
      { amount_paise: 4_000, status: "captured" },
    ];
    expect(refundDuePaise(payments, [])).toBe(14_000);
    expect(refundDuePaise(payments, [{ amount_paise: 4_000, status: "processed" }])).toBe(10_000);
  });

  it("ignores failed refunds so a retry still refunds the full amount", () => {
    expect(
      refundDuePaise(
        [{ amount_paise: 9_000, status: "captured" }],
        [{ amount_paise: 9_000, status: "failed" }],
      ),
    ).toBe(9_000);
  });

  it("counts queued and pending refunds as already refunded", () => {
    const payments = [{ amount_paise: 9_000, status: "captured" }];
    expect(refundDuePaise(payments, [{ amount_paise: 1500, status: "queued" }])).toBe(7_500);
    expect(refundDuePaise(payments, [{ amount_paise: 1500, status: "pending" }])).toBe(7_500);
  });

  it("never goes negative once the booking is fully refunded", () => {
    expect(
      refundDuePaise(
        [{ amount_paise: 5_000, status: "refunded" }],
        [{ amount_paise: 5_000, status: "processed" }],
      ),
    ).toBe(0);
  });

  it("ignores payments that were never captured", () => {
    expect(
      refundDuePaise(
        [
          { amount_paise: 8_000, status: "created" },
          { amount_paise: 2_000, status: "failed" },
        ],
        [],
      ),
    ).toBe(0);
  });

  it("accepts numeric strings from the database", () => {
    expect(
      refundDuePaise(
        [{ amount_paise: "12000", status: "captured" }],
        [{ amount_paise: "2000", status: "processed" }],
      ),
    ).toBe(10_000);
  });

  it("refunds a free booking as nothing rather than throwing", () => {
    expect(refundDuePaise([], [])).toBe(0);
  });
});

describe("isHeldOpen", () => {
  it("is false during the session", () => {
    expect(isHeldOpen(booking, startMs)).toBe(false);
  });

  it("holds the booking open for DISPUTE_HOLD_HOURS after the end", () => {
    expect(isHeldOpen(booking, endMs + 1)).toBe(true);
    expect(isHeldOpen(booking, endMs + DISPUTE_HOLD_HOURS * HOUR - 1)).toBe(true);
  });

  it("lets the lifecycle job complete it once the hold expires", () => {
    expect(isHeldOpen(booking, endMs + DISPUTE_HOLD_HOURS * HOUR)).toBe(false);
  });

  it("is false for an unusable end time", () => {
    expect(isHeldOpen({ status: "disputed", end_time: "nope" }, startMs)).toBe(false);
  });
});

describe("disputeStage", () => {
  const issue = { resolution_deadline: deadline(startMs + 15 * MIN) };

  it("reports no dispute without a pending issue", () => {
    expect(disputeStage(booking, startMs)).toBe("none");
    expect(disputeStage({ ...booking, pending_issue: null }, startMs)).toBe("none");
  });

  it("points at the owner while their window is open", () => {
    expect(disputeStage({ ...booking, pending_issue: issue }, startMs)).toBe("owner");
  });

  it("moves to Usop after the deadline", () => {
    expect(disputeStage({ ...booking, pending_issue: issue }, startMs + 16 * MIN)).toBe("usop");
  });
});

describe("ownerMinutesLeft", () => {
  it("rounds up so a part minute still reads as 1", () => {
    expect(ownerMinutesLeft(openIssue(startMs + 15 * MIN), startMs)).toBe(15);
    expect(ownerMinutesLeft(openIssue(startMs + 15 * MIN), startMs + 14 * MIN + 30e3)).toBe(1);
  });

  it("never goes below zero", () => {
    expect(ownerMinutesLeft(openIssue(startMs), startMs + HOUR)).toBe(0);
  });
});

describe("issueLabel", () => {
  it("uses the driver-facing labels", () => {
    expect(issueLabel("gate_locked")).toBe("Gate or access is locked");
    expect(issueLabel("spot_occupied")).toBe("Someone else is parked in my spot");
  });

  it("falls back to the stored value for an unknown type", () => {
    expect(issueLabel("mystery")).toBe("mystery");
  });
});

describe("OWNER_WINDOW_COPY", () => {
  it("promises the same number of minutes the server enforces", () => {
    expect(OWNER_WINDOW_COPY).toContain(String(ISSUE_RESOLUTION_MINUTES));
    expect(OWNER_WINDOW_COPY).toContain("fix");
  });
});
