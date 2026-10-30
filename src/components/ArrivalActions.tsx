import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { markArrivedFn, markRunningLateFn } from "@/lib/arrival.functions";
import { canMarkArrived, canReportLate } from "@/lib/arrival-window";

type Props = {
  reservation: {
    id: string;
    status: string;
    start_time: string;
    end_time: string;
    arrived_at?: string | null;
    late_notified_at?: string | null;
    slot?: {
      access_instructions?: string | null;
      name?: string | null;
    } | null;
  };
  /** Show the "Getting in" card. Use on cards that don't already display access_instructions. */
  showAccessInstructions?: boolean;
};

const LATE_OPTIONS = [5, 10, 15, 30] as const;

export function ArrivalActions({ reservation, showAccessInstructions = false }: Props) {
  const qc = useQueryClient();
  const markArrived = useServerFn(markArrivedFn);
  const markLate = useServerFn(markRunningLateFn);
  const [busy, setBusy] = useState(false);
  const [lateOpen, setLateOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // The windows are time based: tick once a minute so the controls open and close.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60e3);
    return () => clearInterval(t);
  }, []);

  const alreadyArrived = !!reservation.arrived_at;
  // Same rules the server enforces (src/lib/arrival-window.ts).
  const canArrive = canMarkArrived(reservation, now);
  const canLate = canReportLate(reservation, now);
  const accessInstructions = showAccessInstructions
    ? reservation.slot?.access_instructions
    : null;
  const lateSentAt = alreadyArrived ? null : reservation.late_notified_at;

  useEffect(() => {
    if (!canLate) setLateOpen(false);
  }, [canLate]);

  if (!accessInstructions && !alreadyArrived && !canArrive && !canLate && !lateSentAt) return null;

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

      {alreadyArrived ? (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-1.5 text-xs text-green-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Arrived at{" "}
          {new Date(reservation.arrived_at!).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      ) : (
        (canArrive || canLate) && (
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
        )
      )}

      {lateSentAt && (
        <div className="flex items-center gap-1 text-[11px] text-amber-700">
          <AlertCircle className="h-3 w-3" />
          Owner notified at{" "}
          {new Date(lateSentAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )}
    </div>
  );
}