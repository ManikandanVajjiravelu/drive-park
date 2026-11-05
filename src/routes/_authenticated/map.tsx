import { RouteError, RouteNotFound } from "@/components/RouteError";
import { useEffect, useState, lazy, Suspense, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchSlotsForWindow } from "@/lib/search.functions";
import { sortResults, type SortMode, type QuoteReason } from "@/lib/quote";
import { DURATION_LIMITS } from "@/lib/bookings.schema";
import { supabase } from "@/integrations/supabase/client";
import {
  useSlots,
  useMyFavorites,
  useLotOccupancy,
  useProfile,
  useSlotsPrivate,
  type Slot,
} from "@/lib/queries";
import { isMap3DEnabledHere, canUse3D } from "@/lib/map3d-support";
import { cameraPolicy, ownSlotIds } from "@/lib/map3d-camera";
import type { Map3DItem } from "@/components/Map3DDialog";
import { demandFromOccupancy, occupancyPercent, type DemandLevel } from "@/lib/pricing";
import { DemandBadge } from "@/components/PriceBreakdownCard";
import { ClientOnly } from "@/components/ClientOnly";
import { MapPin, List as ListIcon, Filter, Heart, Navigation2, LocateFixed } from "lucide-react";
import { distanceLabel, priceSliderRange } from "@/lib/google-maps";
import { AMENITIES, slotAmenities, type AmenityKey } from "@/lib/amenities";
import { SLOT_TYPE_LABELS, type SlotType } from "@/lib/pricing";
import { toast } from "sonner";
import { ThemeQuickToggle } from "@/components/ThemeToggle";

const SlotMap = lazy(() => import("@/components/SlotMap"));
const Map3DDialog = lazy(() => import("@/components/Map3DDialog"));

export const Route = createFileRoute("/_authenticated/map")({
  component: MapPage,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
});

const CHENNAI: [number, number] = [13.05, 80.24];

const REASON_TEXT: Record<QuoteReason, string | null> = {
  ok: null,
  booked: "Booked at that time",
  closed: "Closed at that time",
  unavailable: "Not available",
  past: "Start time has passed",
};
const UNIT_LABEL = { hourly: "hours", daily: "days", monthly: "months" } as const;
const localInput = (ms: number) =>
  new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

type WindowQuery = {
  startTime: string;
  duration: number;
  rateType: "hourly" | "daily" | "monthly";
  lat: number;
  lng: number;
};

function haversine(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function MapPage() {
  const { data: slots = [] } = useSlots();
  const { data: favorites = [] } = useMyFavorites();
  const { data: lots = {} } = useLotOccupancy();

  const demandFor = (s: Slot): DemandLevel | undefined => {
    const lot = s.lot_id ? lots[s.lot_id] : undefined;
    if (!lot || !lot.total_slots) return undefined;
    return demandFromOccupancy(occupancyPercent(lot.occupied_slots, lot.total_slots)).level;
  };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [view, setView] = useState<"map" | "list">("map");
  const [origin, setOrigin] = useState<[number, number]>(CHENNAI);
  const [located, setLocated] = useState(false);
  const [locNotice, setLocNotice] = useState<string | null>(null);
  const [destination, setDestination] = useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);
  const [vehicle, setVehicle] = useState<"all" | "car" | "bike" | "both">("all");
  const [rate, setRate] = useState<"hourly" | "daily" | "monthly">("hourly");
  const range = useMemo(() => priceSliderRange(slots, rate), [slots, rate]);
  // null = no limit chosen yet → the slider sits at the max, hiding nothing.
  const [maxPriceChoice, setMaxPriceChoice] = useState<number | null>(null);
  const maxPrice = maxPriceChoice ?? range.max;
  useEffect(() => setMaxPriceChoice(null), [rate]);
  const [amenities, setAmenities] = useState<Set<AmenityKey>>(new Set());
  const [slotTypes, setSlotTypes] = useState<Set<SlotType>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // "When?" time-window search.
  const [arrive, setArrive] = useState(() => localInput(Date.now() + 15 * 60000));
  const [length, setLength] = useState(2);
  const [win, setWin] = useState<WindowQuery | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("distance");
  const lim = DURATION_LIMITS[rate];
  const lengthOk =
    length >= lim.min && length <= lim.max && Number.isInteger(length / lim.step + 1e-9);
  const runSearch = useServerFn(searchSlotsForWindow);
  const search = useQuery({
    queryKey: ["window-search", win],
    enabled: !!win,
    queryFn: () => runSearch({ data: win! }),
    staleTime: 60_000,
    retry: false,
  });
  // A new rate type invalidates the window (lengths mean different units).
  useEffect(() => {
    setWin(null);
    setLength(rate === "hourly" ? 2 : 1);
  }, [rate]);
  function submitWindow() {
    const ms = Date.parse(arrive);
    if (Number.isNaN(ms) || !lengthOk) return;
    setWin({
      startTime: new Date(ms).toISOString(),
      duration: length,
      rateType: rate,
      lat: anchor[0],
      lng: anchor[1],
    });
  }
  const results = useMemo(
    () => new Map((search.data ?? []).map((r) => [r.slotId, r])),
    [search.data],
  );
  const windowActive = !!win && search.isSuccess;
  const windowPrices = useMemo(
    () =>
      windowActive
        ? new Map(
            slots.map((s) => {
              const r = results.get(s.id);
              return [
                s.id,
                {
                  total: r?.totalPrice ?? 0,
                  available: !!r?.available,
                  reasonText: r ? REASON_TEXT[r.reason] : "Not available",
                },
              ] as const;
            }),
          )
        : undefined,
    [windowActive, slots, results],
  );

  const favSet = useMemo(() => new Set(favorites.map((f) => f.slot_id)), [favorites]);

  function locate(userAsked: boolean) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (userAsked) setLocNotice("Location isn't available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin([pos.coords.latitude, pos.coords.longitude]);
        setLocated(true);
        setLocNotice(null);
        if (userAsked) setDestination(null);
      },
      (err) => {
        if (userAsked || err.code === err.PERMISSION_DENIED)
          setLocNotice(
            err.code === err.PERMISSION_DENIED
              ? "Location permission is off. Allow it in your browser settings to see spaces near you."
              : "Couldn't get your location. Showing Chennai.",
          );
      },
      { timeout: 8000 },
    );
  }

  useEffect(() => {
    locate(false);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("slots-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "slots" }, () =>
        qc.invalidateQueries({ queryKey: ["slots"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const anchor = useMemo<[number, number]>(
    () => (destination ? [destination.lat, destination.lng] : origin),
    [destination, origin],
  );

  const filtered = useMemo(() => {
    const rateKey = `${rate}_rate` as const;
    return slots.filter((s) => {
      if (vehicle !== "all" && s.vehicle_type !== vehicle && s.vehicle_type !== "both")
        return false;
      const price = windowActive
        ? (results.get(s.id)?.totalPrice ?? 0)
        : (s as unknown as Record<string, number>)[rateKey];
      if (!windowActive && price > maxPrice) return false;
      if (slotTypes.size && !slotTypes.has((s.slot_type ?? "standard_car") as SlotType))
        return false;
      for (const a of amenities) if (!s[a]) return false;
      return true;
    });
  }, [slots, vehicle, rate, maxPrice, amenities, slotTypes, windowActive, results]);

  const sorted = useMemo(() => {
    const rateKey = `${rate}_rate` as const;
    const items = filtered.map((s) => {
      const r = results.get(s.id);
      return {
        s,
        available: windowActive ? !!r?.available : true,
        distance: haversine(anchor, [s.lat, s.lng]),
        price: windowActive ? (r?.totalPrice ?? Infinity) : Number(s[rateKey]),
        rating: Number(s.rating) || 0,
      };
    });
    return sortResults(items, sortMode).map((i) => i.s);
  }, [filtered, anchor, results, windowActive, sortMode, rate]);
  const openCount = windowActive
    ? sorted.filter((s) => results.get(s.id)?.available).length
    : sorted.filter((s) => s.status === "open").length;

  // 3D (flagged). Locked policy for every slot except the caller's own; exact data is
  // requested only for own slots — never for other users' slots.
  const [open3D, setOpen3D] = useState(false);
  const [can3D, setCan3D] = useState(false);
  useEffect(() => setCan3D(isMap3DEnabledHere() && canUse3D()), []);
  const show3DToggle = can3D;
  const { data: profile } = useProfile();
  const myIds = useMemo(
    () => (show3DToggle ? ownSlotIds(slots, profile?.user_id) : []),
    [show3DToggle, slots, profile?.user_id],
  );
  const { data: ownPrivate } = useSlotsPrivate(myIds);
  const items3D = useMemo<Map3DItem[]>(() => {
    if (!open3D) return [];
    return sorted.slice(0, 20).map((s) => {
      const own = myIds.includes(s.id)
        ? (ownPrivate?.[s.id] as { lat?: number; lng?: number } | undefined)
        : undefined;
      const exact =
        own && typeof own.lat === "number" && typeof own.lng === "number"
          ? { lat: own.lat, lng: own.lng }
          : null;
      return {
        id: s.id,
        name: s.name,
        approxArea: s.approx_area,
        rateLabel: `₹${s[`${rate}_rate`]}/${rate === "hourly" ? "hr" : rate === "daily" ? "day" : "month"}`,
        policy: cameraPolicy({ approx: { lat: s.lat, lng: s.lng }, exact, unlocked: !!exact }),
      };
    });
  }, [open3D, sorted, myIds, ownPrivate, rate]);
  function start3D() {
    if (!canUse3D()) return toast.error("3D isn't available on this device. Showing the 2D map.");
    if (sorted.length === 0) return toast.error("No spaces to show in 3D.");
    setOpen3D(true);
  }

  function openSlot(id: string) {
    navigate({
      to: "/slot/$id",
      params: { id },
      search: win ? { start: win.startTime, length: win.duration, rate: win.rateType } : {},
    });
  }

  async function toggleFav(slotId: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const existing = favorites.find((f) => f.slot_id === slotId);
    if (existing) {
      const { error } = await supabase.from("favorites").delete().eq("id", existing.id);
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("favorites")
        .insert({ driver_id: user.id, slot_id: slotId });
      if (error) toast.error(error.message);
      else toast.success("Saved");
    }
    qc.invalidateQueries({ queryKey: ["my-favorites"] });
  }

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100dvh - 5rem)" }}>
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-5 rounded-b-3xl">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-white/60 font-semibold uppercase tracking-wider truncate max-w-[60vw]">
              {destination
                ? `Near ${destination.label}`
                : located
                  ? "Near you"
                  : "Showing Chennai (location off)"}
            </div>
            <h1 className="text-2xl font-black mt-0.5">Find parking</h1>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-primary">{openCount}</div>
            <div className="text-[10px] text-white/60 font-semibold uppercase">
              {windowActive ? "free then" : "spots open"}
            </div>
          </div>
        </div>

        {destination && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Navigation2 className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="truncate">
                Near <span className="font-bold">{destination.label}</span>
              </span>
            </div>
            <button onClick={() => setDestination(null)} className="text-white/60 font-semibold">
              Clear
            </button>
          </div>
        )}

        <form
          className="mt-3 flex flex-wrap items-end gap-2 text-xs"
          aria-label="When do you need parking?"
          onSubmit={(e) => {
            e.preventDefault();
            submitWindow();
          }}
        >
          <label className="flex-1 min-w-[10rem]">
            <span className="block text-white/60 font-semibold uppercase text-[10px] mb-1">
              When? Arrive
            </span>
            <input
              type="datetime-local"
              value={arrive}
              onChange={(e) => setArrive(e.target.value)}
              className="w-full min-h-11 rounded-xl bg-white/10 px-2 text-white [color-scheme:dark]"
            />
          </label>
          <label className="w-24">
            <span className="block text-white/60 font-semibold uppercase text-[10px] mb-1">
              Length ({UNIT_LABEL[rate]})
            </span>
            <input
              type="number"
              min={lim.min}
              max={lim.max}
              step={lim.step}
              value={length}
              onChange={(e) => setLength(+e.target.value)}
              aria-invalid={!lengthOk}
              className="w-full min-h-11 rounded-xl bg-white/10 px-2 text-white"
            />
          </label>
          <button
            type="submit"
            disabled={!lengthOk}
            className="min-h-11 px-4 rounded-full bg-primary text-primary-foreground font-semibold disabled:opacity-60"
          >
            Search
          </button>
          {win && (
            <button
              type="button"
              onClick={() => setWin(null)}
              className="min-h-11 px-3 rounded-full bg-white/10 font-semibold"
            >
              Clear
            </button>
          )}
        </form>
        {!lengthOk && (
          <p className="mt-1 text-xs text-white/80">
            Length must be {lim.min}–{lim.max} {UNIT_LABEL[rate]}
            {rate === "hourly" ? " in half-hour steps" : ""}.
          </p>
        )}
        {win && search.isError && (
          <div role="alert" className="mt-2 flex items-center gap-2 text-xs">
            <span>{(search.error as Error)?.message || "Search failed."}</span>
            <button
              onClick={() => search.refetch()}
              className="min-h-11 px-3 rounded-full bg-white/10 font-semibold"
            >
              Retry
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <div className="flex-1 flex bg-white/10 rounded-full p-1">
            <button
              onClick={() => setView("map")}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition ${view === "map" ? "bg-primary text-primary-foreground" : "text-white/70"}`}
            >
              <MapPin className="w-3.5 h-3.5" />
              Map
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition ${view === "list" ? "bg-primary text-primary-foreground" : "text-white/70"}`}
            >
              <ListIcon className="w-3.5 h-3.5" />
              List
            </button>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 px-3 py-2 rounded-full text-xs font-semibold ${showFilters ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
          </button>
          <button
            onClick={() => locate(true)}
            aria-label="My location"
            title="My location"
            className="w-11 h-11 grid place-items-center rounded-full bg-white/10 shrink-0"
          >
            <LocateFixed className="w-4 h-4" />
          </button>
          <ThemeQuickToggle className="bg-white/10 text-white shrink-0" />
        </div>
        {locNotice && (
          <p role="status" className="mt-2 text-xs text-white/80">
            {locNotice}
          </p>
        )}

        {showFilters && (
          <div className="mt-4 space-y-3 text-xs animate-in fade-in slide-in-from-top-2 duration-200">
            <div>
              <div className="text-white/60 font-semibold uppercase text-[10px] mb-1.5">
                Vehicle
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(["all", "car", "bike", "both"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVehicle(v)}
                    className={`px-3 py-1.5 rounded-full capitalize font-semibold ${vehicle === v ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-white/60 font-semibold uppercase text-[10px] mb-1.5">Rate</div>
              <div className="flex gap-1.5">
                {(["hourly", "daily", "monthly"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRate(r)}
                    className={`px-3 py-1.5 rounded-full capitalize font-semibold ${rate === r ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-white/60 font-semibold uppercase text-[10px] mb-1.5">
                Space type
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(Object.keys(SLOT_TYPE_LABELS) as SlotType[]).map((k) => {
                  const on = slotTypes.has(k);
                  return (
                    <button
                      key={k}
                      onClick={() =>
                        setSlotTypes((prev) => {
                          const next = new Set(prev);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          return next;
                        })
                      }
                      className={`px-3 py-1.5 rounded-full font-semibold ${on ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
                    >
                      {SLOT_TYPE_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-white/60 font-semibold uppercase text-[10px] mb-1.5">
                Amenities
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {AMENITIES.map((a) => {
                  const on = amenities.has(a.key);
                  return (
                    <button
                      key={a.key}
                      onClick={() =>
                        setAmenities((prev) => {
                          const next = new Set(prev);
                          if (next.has(a.key)) next.delete(a.key);
                          else next.add(a.key);
                          return next;
                        })
                      }
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full font-semibold ${on ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
                    >
                      <a.icon className="w-3 h-3" />
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block">
              <div className="flex justify-between text-white/60 font-semibold uppercase text-[10px] mb-1">
                <span>Max price</span>
                <span className="text-primary">₹{maxPrice}</span>
              </div>
              <input
                type="range"
                aria-label={`Maximum ${rate} price`}
                min={range.min}
                max={range.max}
                step={range.step}
                value={Math.min(maxPrice, range.max)}
                onChange={(e) => setMaxPriceChoice(+e.target.value)}
                className="w-full accent-primary"
              />
            </label>
          </div>
        )}
      </div>

      {view === "map" ? (
        <div className="flex-1 min-h-[60vh] relative">
          {show3DToggle && (
            <div
              role="group"
              aria-label="Map view"
              className="absolute top-3 right-3 z-10 flex rounded-full bg-card/95 shadow p-1 text-xs font-bold"
            >
              <button
                aria-pressed={!open3D}
                onClick={() => setOpen3D(false)}
                className={`min-h-11 min-w-11 px-3 rounded-full ${!open3D ? "bg-primary text-primary-foreground" : ""}`}
              >
                2D
              </button>
              <button
                aria-pressed={open3D}
                onClick={start3D}
                className={`min-h-11 min-w-11 px-3 rounded-full ${open3D ? "bg-primary text-primary-foreground" : ""}`}
              >
                3D
              </button>
            </div>
          )}
          {open3D && (
            <Suspense fallback={null}>
              <Map3DDialog
                items={items3D}
                onClose={() => setOpen3D(false)}
                onFallback={(m) => {
                  toast.error(`${m} Showing the 2D map.`);
                  setOpen3D(false);
                }}
              />
            </Suspense>
          )}
          <ClientOnly
            fallback={<div className="p-6 text-sm text-muted-foreground">Loading map…</div>}
          >
            <Suspense
              fallback={<div className="p-6 text-sm text-muted-foreground">Loading map…</div>}
            >
              <SlotMap
                slots={sorted}
                center={origin}
                rate={rate}
                windowPrices={windowPrices}
                onShowList={() => setView("list")}
                onSelect={openSlot}
                onDestinationChange={setDestination}
              />
            </Suspense>
          </ClientOnly>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <div role="status" className="text-xs text-muted-foreground font-semibold">
              {sorted.length} {sorted.length === 1 ? "spot" : "spots"}{" "}
              {destination ? `near ${destination.label}` : "near you"}
              {windowActive ? ` · ${openCount} free for your time` : ""}
            </div>
            <label className="text-xs flex items-center gap-1">
              <span className="text-muted-foreground">Sort</span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="min-h-11 rounded-lg border border-input bg-background px-2"
              >
                <option value="distance">Distance</option>
                <option value="price">Price low to high</option>
                <option value="rating">Rating</option>
              </select>
            </label>
          </div>
          {win && search.isFetching && (
            <div aria-hidden className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-40 rounded-2xl bg-muted animate-pulse" />
              ))}
            </div>
          )}
          {windowActive && sorted.length > 0 && openCount === 0 && (
            <p role="status" className="text-center text-sm text-muted-foreground py-4">
              Nothing available for that time. Try a different time.
            </p>
          )}
          {sorted.map((s) => (
            <SlotCard
              demand={demandFor(s)}
              key={s.id}
              slot={s}
              anchor={anchor}
              favorited={favSet.has(s.id)}
              onFav={() => toggleFav(s.id)}
              onClick={() => openSlot(s.id)}
              windowResult={windowActive ? (results.get(s.id) ?? null) : undefined}
            />
          ))}
          {sorted.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              No slots match your filters.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SlotCard({
  demand,
  slot,
  anchor,
  favorited,
  onFav,
  onClick,
  windowResult,
}: {
  windowResult?: {
    available: boolean;
    reason: QuoteReason;
    totalPrice: number;
    peak: boolean;
    label: string | null;
  } | null;
  demand?: DemandLevel;
  slot: Slot;
  anchor: [number, number];
  favorited: boolean;
  onFav: () => void;
  onClick: () => void;
}) {
  // Coordinates are approximate until paid, so the distance is rounded.
  const dist = distanceLabel(haversine(anchor, [slot.lat, slot.lng]));
  const windowMode = windowResult !== undefined;
  const full = windowMode ? !windowResult?.available : slot.status === "full";
  const reasonText = windowMode
    ? windowResult
      ? REASON_TEXT[windowResult.reason]
      : "Not available"
    : null;
  return (
    <div
      className={`relative card-elevated overflow-hidden transition ${full ? "opacity-60" : ""}`}
    >
      <button onClick={onClick} className="w-full text-left active:scale-[0.98]">
        <div className="relative">
          {slot.photos[0] ? (
            <img src={slot.photos[0]} alt="" className="w-full h-40 object-cover" />
          ) : (
            <div className="w-full h-40 bg-muted grid place-items-center">
              <MapPin className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
          <div className="absolute top-2 right-2 price-pill">
            {windowMode && windowResult ? (
              <>
                ₹{windowResult.totalPrice}
                <span className="opacity-70 font-semibold"> total</span>
              </>
            ) : (
              <>
                ₹{slot.hourly_rate}
                <span className="opacity-70 font-semibold">/hr</span>
              </>
            )}
          </div>
          {windowMode && full && (
            <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-foreground text-background text-[10px] font-black tracking-wider">
              {reasonText}
            </div>
          )}
          {!windowMode && full && (
            <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-foreground text-background text-[10px] font-black tracking-wider">
              FULL
            </div>
          )}
          {!full && demand && (
            <div className="absolute bottom-2 left-2">
              <DemandBadge level={demand} />
            </div>
          )}
          {!full && (
            <div className="absolute top-2 left-2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/95 text-[10px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              OPEN
            </div>
          )}
        </div>
        <div className="p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-black truncate text-[15px]">{slot.name}</div>
              <div className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3" />
                {slot.approx_area} · {dist} away
              </div>
            </div>
            {slot.rating > 0 && (
              <div className="chip">
                <span className="text-primary">★</span>
                {slot.rating.toFixed(1)}
              </div>
            )}
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
            <span className="chip capitalize">{slot.vehicle_type}</span>
            {slotAmenities(slot).map((a) => (
              <span key={a.key} className="chip">
                <a.icon className="w-3 h-3" />
                {a.label}
              </span>
            ))}
            {windowResult?.peak && windowResult.available && (
              <span className="chip" title={windowResult.label ?? undefined}>
                Peak pricing
              </span>
            )}
            <span className="chip">Daily ₹{slot.daily_rate}</span>
          </div>
        </div>
      </button>
      <button
        onClick={onFav}
        aria-label={favorited ? "Remove from saved" : "Save spot"}
        className="absolute top-3 right-14 w-9 h-9 rounded-full bg-white/95 grid place-items-center shadow"
        style={{ position: "absolute" }}
      >
        <Heart className={`w-4 h-4 ${favorited ? "fill-primary text-primary" : "text-black"}`} />
      </button>
    </div>
  );
}
