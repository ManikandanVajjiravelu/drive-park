import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ClientOnly } from "@/components/ClientOnly";
import { loadGoogleMaps, mapStyleFor, pinIcon } from "@/lib/google-maps";
import type { Slot } from "@/lib/queries";
import { SLOT_TYPE_LABELS, type SlotType } from "@/lib/pricing";

const CHENNAI = { lat: 13.05, lng: 80.24 };

type Mode = { kind: "create" } | { kind: "edit"; slotId: string };

export function SlotForm({ initial, mode }: { initial?: Partial<Slot>; mode: Mode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [copies, setCopies] = useState(1);
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    approx_area: initial?.approx_area ?? "",
    full_address: initial?.full_address ?? "",
    lat: initial?.lat ?? CHENNAI.lat,
    lng: initial?.lng ?? CHENNAI.lng,
    hourly_rate: String(initial?.hourly_rate ?? "40"),
    daily_rate: String(initial?.daily_rate ?? "300"),
    monthly_rate: String(initial?.monthly_rate ?? "6000"),
    vehicle_type: (initial?.vehicle_type ?? "both") as "car" | "bike" | "both",
    vehicle_size_limit: initial?.vehicle_size_limit ?? "",
    access_instructions: initial?.access_instructions ?? "",
    photo_url: initial?.photos?.[0] ?? "",
    covered: initial?.covered ?? false,
    cctv: initial?.cctv ?? false,
    disabled_access: initial?.disabled_access ?? false,
    height_limit_cm: initial?.height_limit_cm != null ? String(initial.height_limit_cm) : "",
    width_limit_cm: initial?.width_limit_cm != null ? String(initial.width_limit_cm) : "",
    slot_type: (initial?.slot_type ?? "standard_car") as SlotType,
    cancellation_policy: (initial?.cancellation_policy ?? "moderate") as
      | "flexible"
      | "moderate"
      | "strict",
  });

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const payload = {
        name: form.name,
        approx_area: form.approx_area,
        full_address: form.full_address,
        lat: form.lat,
        lng: form.lng,
        hourly_rate: parseFloat(form.hourly_rate) || 0,
        daily_rate: parseFloat(form.daily_rate) || 0,
        monthly_rate: parseFloat(form.monthly_rate) || 0,
        vehicle_type: form.vehicle_type,
        vehicle_size_limit: form.vehicle_size_limit,
        access_instructions: form.access_instructions,
        photos: form.photo_url ? [form.photo_url] : [],
        covered: form.covered,
        cctv: form.cctv,
        disabled_access: form.disabled_access,
        height_limit_cm: form.height_limit_cm ? parseInt(form.height_limit_cm) : null,
        width_limit_cm: form.width_limit_cm ? parseInt(form.width_limit_cm) : null,
        cancellation_policy: form.cancellation_policy,
        slot_type: form.slot_type,
      };
      if (mode.kind === "create") {
        const rows = Array.from({ length: copies }, (_, i) => ({
          ...payload,
          owner_id: user.id,
          status: "open",
          name: copies > 1 ? payload.name + " " + (i + 1) : payload.name,
        }));
        const { error } = await supabase.from("slots").insert(rows);
        if (error) throw error;
        toast.success(copies === 1 ? "Slot added" : copies + " slots added");
      } else {
        const { error } = await supabase.from("slots").update(payload).eq("id", mode.slotId);
        if (error) throw error;
        toast.success("Slot updated");
      }
      qc.invalidateQueries({ queryKey: ["my-slots"] });
      qc.invalidateQueries({ queryKey: ["slots"] });
      if (mode.kind === "edit") qc.invalidateQueries({ queryKey: ["slot", mode.slotId] });
      navigate({ to: "/my-slots" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="px-5 py-4 space-y-3">
      <Field label="Name" value={form.name} onChange={set("name")} required />

      {mode.kind === "create" && (
        <Field
          label="Number of identical spaces"
          type="number"
          min={1}
          max={10}
          step={1}
          value={copies}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            setCopies(Number.isNaN(n) ? 1 : Math.min(10, Math.max(1, n)));
          }}
        />
      )}

      <div>
        <span className="text-xs font-semibold text-muted-foreground uppercase">Location</span>
        <div
          className="mt-1 rounded-2xl overflow-hidden border border-border"
          style={{ height: 300 }}
        >
          <ClientOnly
            fallback={<div className="p-4 text-sm text-muted-foreground">Loading map…</div>}
          >
            <LocationPicker
              lat={form.lat}
              lng={form.lng}
              onChange={(loc) =>
                setForm((f) => ({
                  ...f,
                  lat: loc.lat,
                  lng: loc.lng,
                  full_address: loc.address ?? f.full_address,
                  approx_area: loc.area ?? f.approx_area,
                }))
              }
            />
          </ClientOnly>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Search or drag the pin. Address & area auto-fill.
        </p>
      </div>

      <Field
        label="Approx area (public)"
        value={form.approx_area}
        onChange={set("approx_area")}
        required
        placeholder="e.g. Near T Nagar signal"
      />
      <Field
        label="Full address (revealed after booking)"
        value={form.full_address}
        onChange={set("full_address")}
        required
      />

      <div>
        <span className="text-xs font-semibold text-muted-foreground uppercase">Vehicle type</span>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {(["car", "bike", "both"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setForm((f) => ({ ...f, vehicle_type: v }))}
              className={`rounded-xl border-2 py-2 text-xs capitalize font-semibold ${form.vehicle_type === v ? "border-primary bg-primary/10" : "border-border"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="text-xs font-semibold text-muted-foreground uppercase">Slot type</span>
        <select
          aria-label="Slot type"
          value={form.slot_type}
          onChange={(e) => {
            const st = e.target.value as SlotType;
            setForm((f) => ({ ...f, slot_type: st }));
          }}
          className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-3 text-base"
        >
          {(Object.keys(SLOT_TYPE_LABELS) as SlotType[]).map((k) => (
            <option key={k} value={k}>
              {SLOT_TYPE_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <Field
        label="Vehicle size limit"
        value={form.vehicle_size_limit}
        onChange={set("vehicle_size_limit")}
        placeholder="e.g. Sedan / SUV"
      />
      <div className="grid grid-cols-3 gap-2">
        <Field
          label="₹/hour (base for dynamic pricing)"
          value={form.hourly_rate}
          onChange={set("hourly_rate")}
          type="number"
        />
        <Field label="₹/day" value={form.daily_rate} onChange={set("daily_rate")} type="number" />
        <Field
          label="₹/month"
          value={form.monthly_rate}
          onChange={set("monthly_rate")}
          type="number"
        />
      </div>
      <Field
        label="Access instructions"
        value={form.access_instructions}
        onChange={set("access_instructions")}
      />
      <Field
        label="Photo URL"
        value={form.photo_url}
        onChange={set("photo_url")}
        placeholder="https://…"
      />

      <div>
        <span className="text-xs font-semibold text-muted-foreground uppercase">Amenities</span>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {(
            [
              ["covered", "Covered"],
              ["cctv", "CCTV"],
              ["disabled_access", "Accessible"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setForm((f) => ({ ...f, [k]: !f[k] }))}
              className={`rounded-xl border-2 py-2 text-xs font-semibold ${form[k] ? "border-primary bg-primary/10" : "border-border"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Height limit (cm)"
          value={form.height_limit_cm}
          onChange={set("height_limit_cm")}
          type="number"
          placeholder="e.g. 200"
        />
        <Field
          label="Width limit (cm)"
          value={form.width_limit_cm}
          onChange={set("width_limit_cm")}
          type="number"
          placeholder="e.g. 180"
        />
      </div>

      <div>
        <span className="text-xs font-semibold text-muted-foreground uppercase">
          Cancellation policy
        </span>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {(["flexible", "moderate", "strict"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setForm((f) => ({ ...f, cancellation_policy: p }))}
              className={`rounded-xl border-2 py-2 text-xs capitalize font-semibold ${form.cancellation_policy === p ? "border-primary bg-primary/10" : "border-border"}`}
            >
              {p}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {form.cancellation_policy === "flexible" && "Full refund up to start time."}
          {form.cancellation_policy === "moderate" && "Full refund if cancelled 24h before."}
          {form.cancellation_policy === "strict" && "Full refund if cancelled 48h before."}
        </p>
      </div>

      <button
        disabled={busy}
        className="w-full rounded-2xl bg-primary py-4 font-bold text-primary-foreground disabled:opacity-60"
      >
        {busy ? "…" : mode.kind === "create" ? "Save slot" : "Update slot"}
      </button>
    </form>
  );
}

function LocationPicker({
  lat,
  lng,
  onChange,
}: {
  lat: number;
  lng: number;
  onChange: (loc: { lat: number; lng: number; address?: string; area?: string }) => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const inputEl = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        const center = { lat, lng };
        const map = new g.maps.Map(mapEl.current, {
          center,
          zoom: 15,
          styles: mapStyleFor(document.documentElement.classList.contains("dark")),
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        mapRef.current = map;
        geocoderRef.current = new g.maps.Geocoder();

        const marker = new g.maps.Marker({
          position: center,
          map,
          draggable: true,
          icon: {
            url: pinIcon("#F2A522", "#241F3D"),
            scaledSize: new g.maps.Size(36, 44),
            anchor: new g.maps.Point(18, 42),
          },
        });
        markerRef.current = marker;

        const commit = (pos: google.maps.LatLng) => {
          const p = { lat: pos.lat(), lng: pos.lng() };
          geocoderRef.current!.geocode({ location: p }, (results, status) => {
            if (status === "OK" && results?.[0]) {
              const r = results[0];
              const area =
                r.address_components?.find(
                  (c) => c.types.includes("sublocality") || c.types.includes("neighborhood"),
                )?.long_name ||
                r.address_components?.find((c) => c.types.includes("locality"))?.long_name;
              onChange({ ...p, address: r.formatted_address, area });
            } else {
              onChange(p);
            }
          });
        };

        marker.addListener("dragend", () => {
          const pos = marker.getPosition();
          if (pos) {
            map.panTo(pos);
            commit(pos);
          }
        });
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          marker.setPosition(e.latLng);
          commit(e.latLng);
        });

        if (inputEl.current && g.maps.places?.Autocomplete) {
          const ac = new g.maps.places.Autocomplete(inputEl.current, {
            fields: ["geometry", "formatted_address", "address_components", "name"],
          });
          ac.bindTo("bounds", map);
          ac.addListener("place_changed", () => {
            const p = ac.getPlace();
            const loc = p.geometry?.location;
            if (!loc) return;
            map.setCenter(loc);
            map.setZoom(16);
            marker.setPosition(loc);
            const area =
              p.address_components?.find(
                (c) => c.types.includes("sublocality") || c.types.includes("neighborhood"),
              )?.long_name ||
              p.address_components?.find((c) => c.types.includes("locality"))?.long_name ||
              p.name;
            onChange({ lat: loc.lat(), lng: loc.lng(), address: p.formatted_address, area });
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={mapEl} className="absolute inset-0" />
      <div className="absolute top-2 left-2 right-2 z-10">
        <div className="flex items-center gap-2 bg-card text-card-foreground rounded-full shadow px-3 py-2 border border-border">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            aria-label="Search address"
            ref={inputEl}
            placeholder="Search address"
            className="flex-1 outline-none text-sm bg-transparent"
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground uppercase">{label}</span>
      <input
        {...props}
        className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5"
      />
    </label>
  );
}
