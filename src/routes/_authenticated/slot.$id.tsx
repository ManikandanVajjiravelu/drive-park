import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useMap3DEnabled } from "@/lib/map3d-support";
const Slot3DButton = lazy(() => import("@/components/Slot3DButton"));
import {
  useSlot,
  useMyVehicles,
  useOwnerProfile,
  useReviews,
  useMyFavorites,
  useProfile,
  useSlotAvailability,
} from "@/lib/queries";
import { checkWithinHours, SHORT_WEEKDAYS } from "@/lib/availability";
import { isFullGateActive } from "@/lib/quote";

import { supabase } from "@/integrations/supabase/client";
import { sendBookingConfirmation } from "@/lib/emails.functions";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { RouteError, RouteNotFound } from "@/components/RouteError";
import {
  ArrowLeft,
  Star,
  Car,
  Ruler,
  MapPin,
  Navigation2,
  Share2,
  ShieldCheck,
  BadgeCheck,
  Heart,
  Phone,
  MessageCircle,
} from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPricingContext } from "@/lib/pricing.functions";
import { createBookingFn } from "@/lib/bookings.functions";
import { calculatePrice, SLOT_TYPE_LABELS, type SlotType } from "@/lib/pricing";
import { PriceBreakdownCard, DemandBadge } from "@/components/PriceBreakdownCard";
import { durationSchema, validate, MESSAGES } from "@/lib/validation";
import { slotAmenities, POLICY_META } from "@/lib/amenities";
import { PayNowButton } from "@/components/PayNowButton";

type SlotSearch = { start?: string; length?: number; rate?: "hourly" | "daily" | "monthly" };

export const Route = createFileRoute("/_authenticated/slot/$id")({
  // Optional prefill from the map's time-window search; absent params change nothing.
  validateSearch: (s: Record<string, unknown>): SlotSearch => {
    const out: SlotSearch = {};
    if (typeof s.start === "string" && !Number.isNaN(Date.parse(s.start))) out.start = s.start;
    const len = Number(s.length);
    if (Number.isFinite(len) && len > 0 && len <= 744) out.length = len;
    if (s.rate === "hourly" || s.rate === "daily" || s.rate === "monthly") out.rate = s.rate;
    return out;
  },
  component: SlotDetail,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
});

function SlotDetail() {
  const { id } = Route.useParams();
  const prefill = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: slot, isLoading } = useSlot(id);
  const { data: vehicles = [] } = useMyVehicles();
  const { data: owner } = useOwnerProfile(slot?.owner_id ?? "");
  const { data: reviews = [] } = useReviews(id);
  const { data: myProfile } = useProfile();
  const { data: hours = [] } = useSlotAvailability(id);
  const { data: favorites = [] } = useMyFavorites();

  const [rateType, setRateType] = useState<"hourly" | "daily" | "monthly">(
    prefill.rate ?? "hourly",
  );
  const [duration, setDuration] = useState(prefill.length ?? 2);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [startTime, setStartTime] = useState(() => {
    const base = prefill.start ? Date.parse(prefill.start) : Date.now() + 15 * 60000;
    const d = new Date(base - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  });
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [bookedTotal, setBookedTotal] = useState<number | null>(null);
  const createBooking = useServerFn(createBookingFn);
  const [busy, setBusy] = useState(false);
  const map3dEnabled = useMap3DEnabled();
  const [priceEpoch, setPriceEpoch] = useState(0);

  const fetchPricingContext = useServerFn(getPricingContext);
  // Debounced window so the preview measures demand for the chosen time, like the server.
  const [pricingWindow, setPricingWindow] = useState({ startTime, duration });
  useEffect(() => {
    const t = setTimeout(() => setPricingWindow({ startTime, duration }), 400);
    return () => clearTimeout(t);
  }, [startTime, duration]);
  // Re-evaluate the "full right now" gate once a minute.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60e3);
    return () => clearInterval(t);
  }, []);
  const pricingStartIso = (() => {
    const d = new Date(pricingWindow.startTime);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  })();
  const pricingHours =
    pricingWindow.duration > 0 && pricingWindow.duration <= 24 * 31
      ? pricingWindow.duration
      : undefined;
  const { data: pricing, refetch: refetchPricing } = useQuery({
    queryKey: ["pricing-context", id, pricingStartIso, pricingHours],
    queryFn: () =>
      fetchPricingContext({
        data: { slotId: id, startTime: pricingStartIso, durationHours: pricingHours },
      }),
    refetchInterval: 5 * 60 * 1000,
  });

  const favorited = useMemo(() => favorites.some((f) => f.slot_id === id), [favorites, id]);

  useEffect(() => {
    const channel = supabase
      .channel(`slot-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "slots", filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["slot", id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, qc]);

  useEffect(() => {
    if (!vehicleId && vehicles.length) {
      setVehicleId((vehicles.find((v) => v.is_default) ?? vehicles[0]).id);
    }
  }, [vehicles, vehicleId]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!slot) return <div className="p-6">Slot not found</div>;

  const rate = slot[`${rateType}_rate` as const] as number;
  const durationError = rateType === "hourly" ? validate(durationSchema, duration) : null;
  const breakdown =
    rateType === "hourly" && pricing && !durationError
      ? calculatePrice({
          slotType: pricing.slotType,
          baseRate: pricing.baseRate,
          tier: pricing.tier,
          occupiedSlots: pricing.occupiedSlots,
          totalSlots: pricing.totalSlots,
          startTime: new Date(startTime),
          durationHours: duration,
          holidayDates: pricing.holidayDates,
          demandNeutral: pricing.demandNeutral,
        })
      : null;
  void priceEpoch;
  const total = breakdown ? breakdown.grandTotal : rate * duration;
  const isOwner = !!myProfile && myProfile.user_id === slot.owner_id;
  const msPerUnit = rateType === "hourly" ? 3600e3 : rateType === "daily" ? 86400e3 : 30 * 86400e3;
  const hoursError = checkWithinHours(
    hours,
    new Date(startTime),
    new Date(new Date(startTime).getTime() + duration * msPerUnit),
  );

  async function refreshPrice() {
    const previous = breakdown?.grandTotal;
    await refetchPricing();
    setPriceEpoch((n) => n + 1);
    if (previous !== undefined) toast.info("Price lock expired — price refreshed");
  }
  const booked = !!reservationId;
  const isFull = slot.status === "full";
  const showFullGate = isFullGateActive(slot.status, new Date(startTime), new Date(nowTick));

  async function toggleFav() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const existing = favorites.find((f) => f.slot_id === id);
    if (existing) {
      const { error } = await supabase.from("favorites").delete().eq("id", existing.id);
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("favorites")
        .insert({ driver_id: user.id, slot_id: id });
      if (error) toast.error(error.message);
      else toast.success("Saved");
    }
    qc.invalidateQueries({ queryKey: ["my-favorites"] });
  }

  async function reserve() {
    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
      const data = await createBooking({
        data: {
          slotId: slot!.id,
          startTime: new Date(startTime).toISOString(),
          rateType,
          duration,
          vehicleId: vehicle?.id ?? null,
          expectedTotal: total,
        },
      });
      setReservationId(data.reservationId);
      setBookedTotal(data.grandTotal);
      qc.invalidateQueries({ queryKey: ["my-reservations"] });
      qc.invalidateQueries({ queryKey: ["slot", id] });
      toast.success("Reserved!");
      void sendBookingConfirmation({ data: { reservationId: data.reservationId } }).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      if (/no_overlap|conflicting key value|exclusion/i.test(msg)) {
        toast.error("That time is already booked. Try a different slot or time.");
      } else if (/^Price changed to/.test(msg)) {
        toast.error(msg);
        void refetchPricing();
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function notifyMe() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("slot_notify")
      .upsert({ driver_id: user.id, slot_id: slot!.id });
    if (error) toast.error(error.message);
    else toast.success("You'll be notified when it opens");
  }

  return (
    <div className="pb-28">
      <div className="relative">
        {slot.photos[0] ? (
          <img src={slot.photos[0]} alt="" className="w-full h-72 object-cover" />
        ) : (
          <div className="w-full h-72 bg-muted" />
        )}
        <div className="absolute inset-0 hero-scrim pointer-events-none" />
        <button
          onClick={() => navigate({ to: "/map" })}
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/60 backdrop-blur grid place-items-center text-white"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <button
            onClick={toggleFav}
            aria-label={favorited ? "Unsave" : "Save"}
            className="w-10 h-10 rounded-full bg-black/60 backdrop-blur grid place-items-center text-white"
          >
            <Heart className={`w-4 h-4 ${favorited ? "fill-primary text-primary" : ""}`} />
          </button>
          <button
            onClick={async () => {
              const url = `${window.location.origin}/slot/${slot!.id}`;
              const shareData = { title: slot!.name, text: `Parking at ${slot!.approx_area}`, url };
              try {
                if (navigator.share) await navigator.share(shareData);
                else {
                  await navigator.clipboard.writeText(url);
                  toast.success("Link copied");
                }
              } catch {
                /* user cancelled or clipboard denied */
              }
            }}
            className="w-10 h-10 rounded-full bg-black/60 backdrop-blur grid place-items-center text-white"
          >
            <Share2 className="w-4 h-4" />
          </button>
          {isFull ? (
            <span className="px-3 py-1 rounded-full bg-foreground text-background text-[10px] font-black tracking-wider">
              {showFullGate ? "FULL" : "FULL NOW"}
            </span>
          ) : (
            <span className="flex items-center gap-1 px-3 py-1 rounded-full bg-white/95 text-[10px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              OPEN NOW
            </span>
          )}
        </div>
        <div className="absolute bottom-4 left-5 right-5 text-white">
          <h1 className="text-2xl font-black leading-tight drop-shadow flex items-center gap-2">
            {slot.name}
            {owner?.verified && (
              <span
                title="Verified host"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white text-black text-[10px] font-black"
              >
                <BadgeCheck className="w-3.5 h-3.5" />
                VERIFIED
              </span>
            )}
          </h1>
          <div className="flex items-center gap-3 mt-1 text-sm">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {slot.approx_area}
            </span>
            {slot.rating > 0 && (
              <span className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-primary text-primary" />
                {slot.rating.toFixed(1)} · {reviews.length}
              </span>
            )}
          </div>
        </div>
      </div>
      {map3dEnabled && slot.full_address && (
        <Suspense fallback={null}>
          <Slot3DButton slot={slot} />
        </Suspense>
      )}

      <div className="px-5 py-5">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Info icon={<Car className="w-4 h-4" />} label="Vehicle" value={slot.vehicle_type} />
          <Info
            icon={<Ruler className="w-4 h-4" />}
            label="Size"
            value={slot.vehicle_size_limit || "Any"}
          />
        </div>

        {(() => {
          const amens = slotAmenities(slot);
          const hasLimits = slot.height_limit_cm || slot.width_limit_cm;
          if (amens.length === 0 && !hasLimits) return null;
          return (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {amens.map((a) => (
                <span key={a.key} className="chip">
                  <a.icon className="w-3 h-3" />
                  {a.label}
                </span>
              ))}
              {slot.height_limit_cm && <span className="chip">H ≤ {slot.height_limit_cm}cm</span>}
              {slot.width_limit_cm && <span className="chip">W ≤ {slot.width_limit_cm}cm</span>}
            </div>
          );
        })()}

        <div className="mt-4 rounded-xl border border-border p-3 flex items-start gap-2 text-xs">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div>
            <div className="font-bold capitalize">
              {POLICY_META[slot.cancellation_policy].label} cancellation
            </div>
            <div className="text-muted-foreground">
              {POLICY_META[slot.cancellation_policy].blurb}
            </div>
          </div>
        </div>

        {booked ? (
          <div className="mt-6 rounded-2xl bg-primary/10 border-2 border-primary p-5 text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-primary-foreground/70">
              Reservation confirmed
            </div>
            <div className="mt-3 inline-block bg-white p-3 rounded-xl">
              <QRCodeSVG value={reservationId!} size={160} />
            </div>
            <div className="mt-4 text-left space-y-2">
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase">
                  Full address
                </div>
                {slot.full_address ? (
                  <div className="font-semibold">{slot.full_address}</div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Address and access instructions unlock after payment
                  </div>
                )}
              </div>
              {slot.full_address && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase">
                    Access
                  </div>
                  <div>{slot.access_instructions || "None"}</div>
                </div>
              )}
              {owner && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Host</div>
                  <div className="font-semibold">{owner.name || "Host"}</div>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {owner?.phone && (
                <a
                  href={`tel:${owner.phone}`}
                  className="rounded-xl bg-foreground text-background py-3 font-semibold flex items-center justify-center gap-2 text-sm"
                >
                  <Phone className="w-4 h-4" />
                  Call host
                </a>
              )}
              <Link
                to="/messages/$reservationId"
                params={{ reservationId: reservationId! }}
                className={`rounded-xl bg-foreground text-background py-3 font-semibold flex items-center justify-center gap-2 text-sm ${owner?.phone ? "" : "col-span-2"}`}
              >
                <MessageCircle className="w-4 h-4" />
                Message
              </Link>
            </div>
            <PayNowButton
              reservationId={reservationId!}
              amount={bookedTotal ?? breakdown?.grandTotal ?? total}
              slotName={slot.name}
            />

            {slot.full_address && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(slot.full_address)}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 w-full rounded-xl bg-primary text-primary-foreground py-3 font-bold flex items-center justify-center gap-2"
              >
                <Navigation2 className="w-4 h-4" />
                Directions
              </a>
            )}
            <Link
              to="/reservations"
              className="mt-2 inline-block w-full rounded-xl bg-muted py-3 font-semibold"
            >
              View my bookings
            </Link>
          </div>
        ) : showFullGate ? (
          <button
            onClick={notifyMe}
            className="mt-6 w-full rounded-2xl bg-foreground text-background py-4 font-bold"
          >
            Notify me when open
          </button>
        ) : (
          <div className="mt-6 space-y-3">
            {isFull && (
              <p role="status" className="rounded-xl bg-muted px-3 py-2 text-sm">
                This space is full right now. Bookings for later times are open.
              </p>
            )}
            {pricing && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {SLOT_TYPE_LABELS[pricing.slotType as SlotType]}
                  {pricing.lotName ? ` · ${pricing.lotName}` : ""}
                </span>
                <DemandBadge
                  level={
                    calculatePrice({
                      slotType: pricing.slotType,
                      baseRate: pricing.baseRate,
                      tier: pricing.tier,
                      occupiedSlots: pricing.occupiedSlots,
                      totalSlots: pricing.totalSlots,
                      startTime: new Date(),
                      durationHours: 1,
                      demandNeutral: pricing.demandNeutral,
                    }).demandLevel
                  }
                />
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {(["hourly", "daily", "monthly"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRateType(r)}
                  className={`rounded-xl border-2 p-3 text-center text-xs ${rateType === r ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <div className="font-bold capitalize">{r}</div>
                  <div className="text-muted-foreground">
                    ₹{(slot as unknown as Record<string, number>)[`${r}_rate`]}
                  </div>
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Start</span>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase">
                Duration (
                {rateType === "hourly" ? "hours" : rateType === "daily" ? "days" : "months"})
              </span>
              <input
                type="number"
                min={rateType === "hourly" ? 0.5 : 1}
                step={rateType === "hourly" ? 0.5 : 1}
                max={rateType === "monthly" ? 12 : rateType === "daily" ? 30 : 24}
                value={duration}
                onChange={(e) => setDuration(+e.target.value || (rateType === "hourly" ? 0.5 : 1))}
                aria-invalid={!!durationError}
                className={`mt-1 w-full rounded-xl border bg-background px-3 py-2 ${durationError ? "border-destructive" : "border-input"}`}
              />
              {durationError && (
                <span className="mt-1 block text-xs font-medium text-destructive">
                  {MESSAGES.duration}
                </span>
              )}
            </label>
            <div>
              <span className="text-xs font-semibold text-muted-foreground uppercase">Vehicle</span>
              {vehicles.length === 0 ? (
                <Link
                  to="/vehicles"
                  className="mt-1 flex items-center justify-between rounded-xl border-2 border-dashed border-border px-3 py-3 text-sm"
                >
                  <span className="text-muted-foreground">No vehicles saved</span>
                  <span className="font-bold text-primary-foreground bg-primary px-2 py-0.5 rounded-lg text-xs">
                    Add
                  </span>
                </Link>
              ) : (
                <div className="mt-1 flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
                  {vehicles.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setVehicleId(v.id)}
                      className={`shrink-0 rounded-xl border-2 px-3 py-2 text-left text-xs ${vehicleId === v.id ? "border-primary bg-primary/10" : "border-border"}`}
                    >
                      <div className="font-black tracking-wider">{v.plate}</div>
                      <div className="text-muted-foreground truncate max-w-[9rem]">
                        {[v.make, v.colour].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </button>
                  ))}
                  <Link
                    to="/vehicles"
                    className="shrink-0 rounded-xl border-2 border-dashed border-border px-3 py-2 text-xs font-semibold grid place-items-center"
                  >
                    + Add
                  </Link>
                </div>
              )}
            </div>
            {breakdown ? (
              <PriceBreakdownCard
                breakdown={breakdown}
                slotTypeLabel={SLOT_TYPE_LABELS[pricing!.slotType as SlotType]}
                onLockExpired={refreshPrice}
              />
            ) : (
              <div className="flex items-baseline justify-between rounded-xl bg-muted p-4">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-2xl font-black">₹{total}</span>
              </div>
            )}
            {hoursError && (
              <p className="text-xs text-destructive">{hoursError} Pick another time.</p>
            )}
            <button
              disabled={
                busy || !!durationError || !!hoursError || (rateType === "hourly" && !breakdown)
              }
              onClick={reserve}
              className="w-full rounded-2xl bg-primary py-4 font-bold text-primary-foreground disabled:opacity-60"
            >
              {busy ? "…" : "Reserve now"}
            </button>
          </div>
        )}

        {hours.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Opening hours
            </h2>
            <div className="rounded-xl bg-card border border-border divide-y divide-border">
              {hours.map((h) => (
                <div key={h.id} className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{SHORT_WEEKDAYS[h.weekday]}</span>
                  <span className="font-semibold">
                    {h.closed
                      ? "Closed"
                      : `${h.open_time.slice(0, 5)} – ${h.close_time.slice(0, 5)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Reviews
          </h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <div className="space-y-2">
              {reviews.slice(0, 5).map((r) => (
                <div key={r.id} className="rounded-xl bg-card border border-border p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">{r.driver?.name || "Driver"}</div>
                    <div className="text-xs flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3 h-3 ${i < r.rating ? "fill-primary text-primary" : "text-muted-foreground"}`}
                        />
                      ))}
                    </div>
                  </div>
                  {r.comment && <p className="mt-1 text-sm">{r.comment}</p>}
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                  </div>
                  {r.owner_reply && (
                    <div className="mt-2 rounded-lg bg-muted p-2">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Host response
                      </div>
                      <p className="text-sm">{r.owner_reply}</p>
                    </div>
                  )}
                  {isOwner && !r.owner_reply && <OwnerReply reviewId={r.id} slotId={id} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground uppercase">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-semibold capitalize">{value}</div>
    </div>
  );
}

function OwnerReply({ reviewId, slotId }: { reviewId: string; slotId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const { error } = await supabase
      .from("reviews")
      .update({ owner_reply: body, owner_reply_at: new Date().toISOString() })
      .eq("id", reviewId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setText("");
    toast.success("Reply posted");
    qc.invalidateQueries({ queryKey: ["reviews", slotId] });
  }

  return (
    <div className="mt-2 flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Reply as host…"
        className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm"
      />
      <button
        onClick={submit}
        disabled={busy || !text.trim()}
        className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
      >
        Reply
      </button>
    </div>
  );
}
