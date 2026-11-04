import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Clock, CheckCircle2, AlertCircle, AlertTriangle, X } from "lucide-react";
import { markArrivedFn, markRunningLateFn, reportIssueFn } from "@/lib/arrival.functions";
import {
  PARKING_ISSUE_LABELS,
  PARKING_ISSUE_TYPES,
  canMarkArrived,
  canReportLate,
  canReportParkingIssue,
  type ParkingIssueType,
} from "@/lib/arrival-window";
import { OWNER_WINDOW_COPY } from "@/lib/disputes-window";

type Props = {
  reservation: {
    id: string;
    status: string;
    start_time: string;
    end_time: string;
    arrived_at?: string | null;
    late_notified_at?: string | null;
    /** Open "Can't Park" report, joined by myReservationsQuery. */
    pending_issue?: {
      id: string;
      issue_type: string;
      resolution_deadline: string;
    } | null;
    slot?: {
      access_instructions?: string | null;
      name?: string | null;
    } | null;
  };
  /** Show the "Getting in" card. Use on cards that don't already display access_instructions. */
  showAccessInstructions?: boolean;
};

const LATE_OPTIONS = [5, 10, 15, 30] as const;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ArrivalActions({ reservation, showAccessInstructions = false }: Props) {
  const qc = useQueryClient();
  const markArrived = useServerFn(markArrivedFn);
  const markLate = useServerFn(markRunningLateFn);
  const reportIssue = useServerFn(reportIssueFn);
  const [busy, setBusy] = useState(false);
  const [lateOpen, setLateOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueType, setIssueType] = useState<ParkingIssueType>("spot_occupied");
  const [note, setNote] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // The windows are time based: tick once a minute so the controls open and close.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60e3);
    return () => clearInterval(t);
  }, []);

  const alreadyArrived = !!reservation.arrived_at;
  const pendingIssue = reservation.pending_issue ?? null;
  // Same rules the server enforces (src/lib/arrival-window.ts).
  const canArrive = canMarkArrived(reservation, now);
  const canLate = canReportLate(reservation, now);
  const canReportIssue = canReportParkingIssue(
    {
      status: reservation.status,
      end_time: reservation.end_time,
      pending_issue: !!pendingIssue,
    },
    now,
  );
  const accessInstructions = showAccessInstructions
    ? reservation.slot?.access_instructions
    : null;
  const lateSentAt = alreadyArrived ? null : reservation.late_notified_at;
  const pendingIssueLabel = pendingIssue
    ? (PARKING_ISSUE_LABELS[pendingIssue.issue_type as ParkingIssueType] ?? pendingIssue.issue_type)
    : null;

  useEffect(() => {
    if (!canLate) setLateOpen(false);
  }, [canLate]);

  useEffect(() => {
    if (!canReportIssue) setIssueOpen(false);
  }, [canReportIssue]);

  if (
    !accessInstructions &&
    !alreadyArrived &&
    !canArrive &&
    !canLate &&
    !canReportIssue &&
    !pendingIssue &&
    !lateSentAt
  )
    return null;

  async function onArrived() {
    setBusy(true);
    try {
      const res = await markArrived({ data: { reservationId: reservation.id } });
      toast.success(
        res.alreadyArrived ? "You were already marked as arrived" : "Owner notified - you're here",
      );
      qc.invalidateQueries({ queryKey: ["my-reservations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark arrival");
    } finally {
      setBusy(false);
    }
  }

  async function onLate(minutes: number) {
    setLateOpen(false);
    setBusy(true);
    try {
      await markLate({ data: { reservationId: reservation.id, minutes } });
      toast.success(`Owner notified - ~${minutes} min late`);
      qc.invalidateQueries({ queryKey: ["my-reservations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send late notice");
    } finally {
      setBusy(false);
    }
  }

  async function onReportIssue() {
    setBusy(true);
    try {
      await reportIssue({
        data: {
          reservationId: reservation.id,
          issueType,
          note: note.trim() || undefined,
        },
      });
      setIssueOpen(false);
      setNote("");
      toast.success(
        `We've notified the owner — ${OWNER_WINDOW_COPY}, otherwise you get a full refund.`,
      );
      qc.invalidateQueries({ queryKey: ["my-reservations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not report the issue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {accessInstructions && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs">
          <div className="flex items-start gap-1.5">
            <MapPin className="h-3 w-3 mt-0.5 text-blue-600 flex-shrink-0" />
            <div>
              <div className="font-semibold text-blue-900">Getting in</div>
              <div className="text-blue-800 whitespace-pre-line">{accessInstructions}</div>
            </div>
          </div>
        </div>
      )}

      {alreadyArrived && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-1.5 text-xs text-green-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Arrived at {clock(reservation.arrived_at!)}
        </div>
      )}

      {/* The red rescue button sits beside "I'm here" and survives arrival: most drivers
          only discover the problem once they are standing at the space. */}
      {(canArrive || canReportIssue || canLate) && (
        <div className="flex flex-wrap gap-2">
          {canArrive && (
              <button
                type="button"
                disabled={busy}
                onClick={onArrived}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <MapPin className="h-3.5 w-3.5" />
                I'm here
              </button>
            )}

          {canReportIssue && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setIssueOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Can&apos;t Park
            </button>
          )}

          {canLate && (
              <div className="relative">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setLateOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  <Clock className="h-3.5 w-3.5" />
                  Running late
                </button>
                {lateOpen && (
                  <div className="absolute z-10 mt-1 w-36 rounded-lg border bg-white shadow-lg">
                    {LATE_OPTIONS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => onLate(m)}
                        className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-100"
                      >
                        ~{m} min late
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
        </div>
      )}

      {pendingIssue && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            Issue reported · owner notified
          </div>
          <div className="mt-0.5">
            {pendingIssueLabel ? `${pendingIssueLabel}. ` : ""}
            Full refund if it isn&apos;t resolved by {clock(pendingIssue.resolution_deadline)}.
          </div>
        </div>
      )}

      {lateSentAt && (
        <div className="flex items-center gap-1 text-[11px] text-amber-700">
          <AlertCircle className="h-3 w-3" />
          Owner notified at {clock(lateSentAt)}
        </div>
      )}

      {issueOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          onClick={() => !busy && setIssueOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-black">Can&apos;t Park</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tell the owner what&apos;s wrong — {OWNER_WINDOW_COPY}, or you get a full refund.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setIssueOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-full bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-3 space-y-1.5">
              {PARKING_ISSUE_TYPES.map((t) => (
                <label
                  key={t}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                    issueType === t
                      ? "border-destructive bg-destructive/5 font-semibold"
                      : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="parking-issue"
                    value={t}
                    checked={issueType === t}
                    onChange={() => setIssueType(t)}
                  />
                  {PARKING_ISSUE_LABELS[t]}
                </label>
              ))}
            </div>

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 280))}
              rows={2}
              placeholder="Anything else the owner should know? (optional)"
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
            />

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setIssueOpen(false)}
                className="flex-1 rounded-xl border border-border py-2 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onReportIssue}
                className="flex-1 rounded-xl bg-destructive py-2 text-xs font-bold text-destructive-foreground disabled:opacity-50"
              >
                {busy ? "Reporting…" : "Report issue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}