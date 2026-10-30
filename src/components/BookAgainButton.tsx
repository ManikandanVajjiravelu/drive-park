import { Link } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { rebookSearch, type RebookReservation } from "@/lib/rebook";

type Props = {
  reservation: RebookReservation & { slot_id: string };
  className?: string;
};

export function BookAgainButton({ reservation, className }: Props) {
  if (!reservation.slot_id) return null;
  const search = rebookSearch(reservation);
  return (
    <Link
      to="/slot/$id"
      params={{ id: reservation.slot_id }}
      search={search}
      className={
        className ??
        "rounded-xl bg-primary text-primary-foreground py-2 text-xs font-semibold flex items-center justify-center gap-1"
      }
    >
      <RotateCcw className="w-3.5 h-3.5" />
      Book again
    </Link>
  );
}