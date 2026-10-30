import { RouteError, RouteNotFound } from "@/components/RouteError";
import { useServerFn } from "@tanstack/react-start";
import { endSessionFn, extendBookingFn, cancelBookingFn } from "@/lib/bookings.functions";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useMyReservations } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Phone,
  Navigation2,
  MapPin,
  ShieldCheck,
  Receipt,
  X,
  Printer,
  Car,
  MessageCircle,
  Star,
} from "lucide-react";
import { POLICY_META } from "@/lib/amenities";
import { billedAmount } from "@/lib/money";
import { cancellationRefundShare } from "@/lib/refund-policy";
import { PayNowButton } from "@/components/PayNowButton";
import { BookAgainButton } from "@/components/BookAgainButton";
import type { Reservation, Slot } from "@/lib/queries";

type ReservationWithSlot = Reservation & { slot: Slot | null };

export const Route = createFileRoute("/_authenticated/reservations")({
  component: MyReservations,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
});

function useCountdown(end: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(end).getTime() - now);
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  const s = Math.floor((ms % 60e3) / 1000);
  return `${h}h ${m}m ${s}s`;
}

function MyReservations() {
  const { data: reservations = [], isLoading, isError, error, refetch } = useMyReservations();
  const qc = useQueryClient();
  const [reviewing, setReviewing] = useState<{ slotId: string; reservationId: string } | null>(
    null,
  );
  const [receipt, setReceipt] = useState<ReservationWithSlot | null>(null);
  const endSessionServer = useServerFn(endSessionFn);
  const extendServer = useServerFn(extendBookingFn);
  const cancelServer = useServerFn(cancelBookingFn);

  const active = reservations.filter((r) => r.status === "active");
  const upcoming = reservations.filter((r) => r.status === "upcoming");
  const past = reservations.filter((r) => r.status === "completed" || r.status === "cancelled");

  async function endSession(r: ReservationWithSlot) {
    if (!confirm("End session now? You'll be charged only for the time used.")) return;
    try {
      const res = await endSessionServer({ data: { reservationId: r.id } });
      toast.success(res.refund > 0 ? `Session ended · charged ₹${res.finalPrice} · ₹${res.refund} refund on its way` : `Session ended · charged ₹${res.finalPrice}`);
      qc.invalidateQueries({ queryKey: ["my-reservations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not end session");
    }
  }

  async function extend(r: ReservationWithSlot, minutes: number) {
    try {
      const res = await extendServer({ data: { reservationId: r.id, minutes } });
      toast.success(res.needsPayment ? `Pay ₹${res.extraCost} within 15 min to confirm +${minutes} min` : `+${minutes} min · ₹${res.extraCost}`);
      qc.invalidateQueries({ queryKey: ["my-reservations"] });
      qc.invalidateQueries({ queryKey: ["reservation-payment", r.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not extend");
    }
  }

  async function cancel(id: string, slot: Slot | null, startTime: string) {
    const policy = (slot?.cancellation_policy ?? "moderate") as "flexible" | "moderate" | "strict";
    const r0 = reservations.find((x) => x.id === id);
    const share = cancellationRefundShare(policy, startTime, Date.now(), r0?.created_at);
    const msg = share === 1
      ? `Cancel this booking? You'll get a full refund (${POLICY_META[policy].label} policy).`
      : share > 0
        ? `Cancel this booking? You'll get a ${Math.round(share * 100)}% refund (${POLICY_META[policy].label} policy).`
        : `Cancel this booking? No refund per ${POLICY_META[policy].label} policy (${POLICY_META[policy].hoursBefore}h notice required).`;
    if (!confirm(msg)) return;
    let error: string | null = null;
    let refunded = 0;
    try {
      refunded = (await cancelServer({ data: { reservationId: id } })).refund;
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not cancel";
    }
    if (error) toast.error(error);
    else {
      toast.success(refunded > 0 ? `Cancelled — ₹${refunded} refund on its way` : "Cancelled");
      qc.invalidateQueries({ queryKey: ["my-reservations"] });
    }
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (isError)
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-sm text-destructive">
          Couldn't load bookings. {error instanceof Error ? error.message : ""}
        </p>
        <button
          onClick={() => refetch()}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
        >
          Retry
        </button>
      </div>
    );

  return (
    <div className="pb-24">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-4">
        <h1 className="text-2xl font-black">My Bookings</h1>
      </div>
      <div className="px-4 py-4 space-y-6">
        {active.length > 0 && (
          <Section title="Active">
            {active.map((r) => (
              <ActiveCard key={r.id} r={r} onEnd={endSession} onExtend={extend} />
            ))}
          </Section>
        )}
        {upcoming.length > 0 && (
          <Section title="Upcoming">
            {upcoming.map((r) => (
              <UpcomingCard key={r.id} r={r} onCancel={cancel} />
            ))}
          </Section>
        )}
        {past.length > 0 && (
          <Section title="Past">
            {past.map((r) => (
              <div key={r.id} className="rounded-2xl bg-card border border-border p-4">
                <div className="font-semibold">{r.slot?.name ?? "Slot"}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.start_time).toLocaleString()} · ₹{billedAmount(r)}
                </div>
                {r.vehicle_plate && (
                  <div className="mt-1 text-[11px] flex items-center gap-1 text-muted-foreground">
                    <Car className="w-3 h-3" />
                    {r.vehicle_plate}
                  </div>
                )}
                <div className="mt-2 flex gap-2 flex-wrap">
                  {r.status === "completed" && new Date(r.end_time).getTime() <= Date.now() && (
                    <button
                      onClick={() => setReviewing({ slotId: r.slot_id, reservationId: r.id })}
                      className="text-xs font-semibold text-primary-foreground bg-primary px-3 py-1.5 rounded-lg flex items-center gap-1"
                    >
                      <Star className="w-3 h-3" />
                      Leave review
                    </button>
                  )}
                                    <button
                    onClick={() => setReceipt(r as ReservationWithSlot)}
                    className="text-xs font-semibold border border-border px-3 py-1.5 rounded-lg flex items-center gap-1"
                  >
                    <Receipt className="w-3 h-3" />
                    Receipt
                  </button>
                  <BookAgainButton
                    reservation={r}
                    className="text-xs font-semibold border border-primary text-primary px-3 py-1.5 rounded-lg flex items-center gap-1"
                  />
                </div>
              </div>
            ))}
          </Section>
        )}
        {reservations.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">No bookings yet.</p>
        )}
      </div>
      {reviewing && (
        <ReviewModal
          slotId={reviewing.slotId}
          reservationId={reviewing.reservationId}
          onClose={() => setReviewing(null)}
        />
      )}
      {receipt && <ReceiptModal r={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ActiveCard({
  r,
  onEnd,
  onExtend,
}: {
  r: ReservationWithSlot;
  onEnd: (r: ReservationWithSlot) => void;
  onExtend: (r: ReservationWithSlot, minutes: number) => void;
}) {
  const remaining = useCountdown(r.end_time);
  const slot = r.slot;
  if (!slot) return null;
  return (
    <div className="rounded-2xl bg-primary/10 border-2 border-primary p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="font-bold">{slot.name}</div>
          <div className="text-xs flex items-center gap-1 text-muted-foreground">
            <MapPin className="w-3 h-3" />
            {slot.full_address}
          </div>
          {r.vehicle_plate && (
            <div className="mt-1 text-[11px] flex items-center gap-1 font-semibold">
              <Car className="w-3 h-3" />
              {r.vehicle_plate}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase text-muted-foreground">Ends in</div>
          <div className="font-mono font-bold text-sm">{remaining}</div>
        </div>
      </div>
      {slot.access_instructions && (
        <div className="mt-2 text-xs bg-background/60 border border-border rounded-lg p-2">{slot.access_instructions}</div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <HostCall ownerId={slot.owner_id} />
        <Link
          to="/messages/$reservationId"
          params={{ reservationId: r.id }}
          className="rounded-xl bg-foreground text-background py-2 text-xs font-semibold flex items-center justify-center gap-1"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          Message
        </Link>
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${slot.lat},${slot.lng}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl bg-foreground text-background py-2 text-xs font-semibold flex items-center justify-center gap-1"
        >
          <Navigation2 className="w-3.5 h-3.5" />
          Route
        </a>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          onClick={() => onExtend(r, 15)}
          className="rounded-xl border border-black py-2 text-xs font-semibold"
        >
          +15 min
        </button>
        <button
          onClick={() => onExtend(r, 30)}
          className="rounded-xl border border-black py-2 text-xs font-semibold"
        >
          +30 min
        </button>
        <button
          onClick={() => onExtend(r, 60)}
          className="rounded-xl border border-black py-2 text-xs font-semibold"
        >
          +1 hr
        </button>
      </div>
      <button
        onClick={() => onEnd(r)}
        className="mt-2 w-full rounded-xl bg-destructive text-destructive-foreground py-2 text-xs font-semibold"
      >
        End session (prorated)
      </button>
      {r.pending_extension && new Date(r.pending_extension.expires_at).getTime() > Date.now() ? (
        <PayNowButton reservationId={r.id} amount={0} slotName={slot.name} />
      ) : null}
    </div>
  );
}

function HostCall({ ownerId }: { ownerId: string }) {
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("profiles")
      .select("phone")
      .eq("user_id", ownerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPhone(data?.phone ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId]);
  return (
    <a
      href={phone ? `tel:${phone}` : undefined}
      className={`rounded-xl bg-foreground text-background py-2 text-xs font-semibold flex items-center justify-center gap-1 ${!phone ? "opacity-50 pointer-events-none" : ""}`}
    >
      <Phone className="w-3.5 h-3.5" />
      Call
    </a>
  );
}

function UpcomingCard({
  r,
  onCancel,
}: {
  r: ReservationWithSlot;
  onCancel: (id: string, slot: Slot | null, start: string) => void;
}) {
  const slot = r.slot;
  const policy = (slot?.cancellation_policy ?? "moderate") as "flexible" | "moderate" | "strict";
  const share = cancellationRefundShare(policy, r.start_time, Date.now(), r.created_at);
  return (
    <div className="rounded-2xl bg-card border border-border p-4">
      <div className="font-bold">{slot?.name}</div>
      <div className="text-xs text-muted-foreground">{new Date(r.start_time).toLocaleString()}</div>
      <div className="mt-1 text-sm font-semibold">
        ₹{r.total_price} · {r.rate_type}
      </div>
      {r.vehicle_plate && (
        <div className="mt-1 text-[11px] flex items-center gap-1 text-muted-foreground">
          <Car className="w-3 h-3" />
          {r.vehicle_plate}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        <ShieldCheck className="w-3 h-3" />
        <span className="capitalize">{POLICY_META[policy].label}</span> ·{" "}
        {share === 1 ? "Full refund if cancelled now" : share > 0 ? `${Math.round(share * 100)}% refund if cancelled now` : "No refund if cancelled now"}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          to="/messages/$reservationId"
          params={{ reservationId: r.id }}
          className="rounded-xl bg-foreground text-background py-2 text-xs font-semibold flex items-center justify-center gap-1"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          Message host
        </Link>
        <button
          onClick={() => onCancel(r.id, slot, r.start_time)}
          className="rounded-xl border border-destructive text-destructive py-2 text-xs font-semibold"
        >
          Cancel
        </button>
      </div>
      <PayNowButton
        reservationId={r.id}
        amount={Number(r.total_price)}
        slotName={slot?.name ?? "Parking slot"}
      />

    </div>
  );
}

function ReceiptModal({ r, onClose }: { r: ReservationWithSlot; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  function printReceipt() {
    const html = ref.current?.innerHTML ?? "";
    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) return;
    w.document.write(
      `<html><head><title>Receipt ${r.id.slice(0, 8)}</title><style>body{font-family:system-ui;padding:24px;color:#111}h1{margin:0 0 8px}hr{border:0;border-top:1px dashed #999;margin:12px 0}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:14px}dt{color:#666}strong{font-size:20px}</style></head><body>${html}</body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 100);
  }
  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h3 className="font-black text-lg">Receipt</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 grid place-items-center rounded-full bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div ref={ref} className="px-5 py-3 text-sm">
          <h1 className="text-lg font-black">Usop Parking</h1>
          <div className="text-xs text-muted-foreground">
            Receipt #{r.id.slice(0, 8).toUpperCase()}
          </div>
          <hr className="my-3 border-dashed border-border" />
          <dl className="grid grid-cols-[auto,1fr] gap-y-1.5 gap-x-3">
            <dt className="text-muted-foreground">Slot</dt>
            <dd className="font-semibold">{r.slot?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Address</dt>
            <dd>{r.slot?.full_address ?? r.slot?.approx_area ?? "—"}</dd>
            <dt className="text-muted-foreground">Vehicle</dt>
            <dd className="font-mono">{r.vehicle_plate ?? "—"}</dd>
            <dt className="text-muted-foreground">Start</dt>
            <dd>{new Date(r.start_time).toLocaleString()}</dd>
            <dt className="text-muted-foreground">End</dt>
            <dd>{new Date(r.end_time).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Rate</dt>
            <dd className="capitalize">{r.rate_type}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="capitalize">{r.status}</dd>
          </dl>
          <hr className="my-3 border-dashed border-border" />
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Total paid</span>
            <strong className="text-xl font-black">₹{billedAmount(r)}</strong>
            {billedAmount(r) !== Number(r.total_price) && (
              <div className="text-xs text-muted-foreground">Charged ₹{r.total_price} · refund ₹{(Number(r.total_price) - billedAmount(r)).toFixed(2)}</div>
            )}
          </div>
          <div className="mt-4 text-[10px] text-muted-foreground text-center">
            Thank you for parking with Usop
          </div>
        </div>
        <div className="px-5 pb-5">
          <button
            onClick={printReceipt}
            className="w-full rounded-xl bg-primary py-2.5 font-bold text-primary-foreground flex items-center justify-center gap-2"
          >
            <Printer className="w-4 h-4" />
            Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewModal({
  slotId,
  reservationId,
  onClose,
}: {
  slotId: string;
  reservationId: string;
  onClose: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function submit() {
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const { error } = await supabase.from("reviews").insert({
      slot_id: slotId,
      driver_id: user.id,
      rating,
      comment: comment.trim(),
      reservation_id: reservationId,
    });
    setBusy(false);
    if (error) {
      if (error.code === "23505") toast.error("You've already reviewed this booking.");
      else toast.error(error.message);
    } else {
      toast.success("Review posted");
      qc.invalidateQueries({ queryKey: ["reviews", slotId] });
      qc.invalidateQueries({ queryKey: ["slot", slotId] });
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg">Rate this spot</h3>
        <div className="flex gap-1 my-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setRating(n)}
              className={`text-3xl ${n <= rating ? "text-primary" : "text-muted"}`}
            >
              ★
            </button>
          ))}
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          placeholder="Optional comment"
          className="w-full border border-input rounded-xl p-3 text-sm"
        />
        <div className="flex gap-2 mt-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-border py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={submit}
            className="flex-1 rounded-xl bg-primary py-2 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
