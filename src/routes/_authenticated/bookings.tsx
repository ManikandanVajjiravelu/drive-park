import { RouteError, RouteNotFound } from "@/components/RouteError";
import { createFileRoute } from "@tanstack/react-router";
import { billedAmount } from "@/lib/money";
import { useEffect } from "react";
import { useOwnerBookings } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/bookings")({
  component: Bookings,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
});

function Bookings() {
  const { data: bookings = [], isLoading, isError, error, refetch } = useOwnerBookings();
  const qc = useQueryClient();

  useEffect(() => {
    const ch = supabase
      .channel("owner-res")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, () =>
        qc.invalidateQueries({ queryKey: ["owner-bookings"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

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

  // Group by slot
  const bySlot = new Map<string, typeof bookings>();
  bookings.forEach((b) => {
    const arr = bySlot.get(b.slot_id) ?? [];
    arr.push(b);
    bySlot.set(b.slot_id, arr);
  });

  return (
    <div>
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-4">
        <h1 className="text-2xl font-black">Bookings</h1>
      </div>
      <div className="px-4 py-4 space-y-5">
        {[...bySlot.entries()].map(([slotId, list]) => (
          <div key={slotId}>
            <h2 className="text-sm font-bold mb-2">{list[0].slot?.name ?? "Slot"}</h2>
            <div className="space-y-2">
              {list.map((b) => (
                <div key={b.id} className="rounded-xl bg-card border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{b.driver?.name || "Driver"}</div>
                      <div className="text-xs text-muted-foreground">{b.driver?.phone}</div>
                      <div className="text-xs mt-1">
                        {new Date(b.start_time).toLocaleString()} →{" "}
                        {new Date(b.end_time).toLocaleString()}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        b.status === "active"
                          ? "bg-primary text-primary-foreground"
                          : b.status === "disputed"
                            ? "bg-destructive text-destructive-foreground"
                            : b.status === "completed"
                              ? "bg-foreground text-background"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-bold">₹{billedAmount(b)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {bookings.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">No bookings yet.</p>
        )}
      </div>
    </div>
  );
}
