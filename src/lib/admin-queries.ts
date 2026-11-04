import { queryOptions, useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billedAmount } from "@/lib/money";
import { ownerCanResolve, refundDuePaise } from "@/lib/disputes-window";
import { supabase } from "@/integrations/supabase/client";
import { SLOT_COLUMNS, withPrivate } from "@/lib/queries";
import type { Database } from "@/integrations/supabase/types";
import type { Database as AugmentedDatabase } from "@/types/supabase-augment";

export type ApprovalStatus = Database["public"]["Enums"]["approval_status"];

export type PromoCode = Database["public"]["Tables"]["promo_codes"]["Row"];
export type AdminProfile = Database["public"]["Tables"]["profiles"]["Row"];
export type AdminSlot = Database["public"]["Tables"]["slots"]["Row"];
export type AdminReview = Database["public"]["Tables"]["reviews"]["Row"];
export type AdminSupport = Database["public"]["Tables"]["support_requests"]["Row"];
export type AdminPayment = Database["public"]["Tables"]["payments"]["Row"];
export type AdminReservation = Database["public"]["Tables"]["reservations"]["Row"];

// arrival_issues (migration 0015) only exists in the augment, not in the generated types yet.
const augDb = supabase as unknown as SupabaseClient<AugmentedDatabase>;

export const isAdminQuery = () =>
  queryOptions({
    queryKey: ["is-admin"],
    queryFn: async (): Promise<boolean> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
    staleTime: 5 * 60_000,
  });
export const useIsAdmin = () => useQuery(isAdminQuery());

export const adminUsersQuery = () =>
  queryOptions({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<AdminProfile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
export const useAdminUsers = () => useQuery(adminUsersQuery());

export const adminSlotsQuery = (status?: ApprovalStatus) =>
  queryOptions({
    queryKey: ["admin-slots", status ?? "all"],
    queryFn: async (): Promise<AdminSlot[]> => {
      let q = supabase.from("slots").select(SLOT_COLUMNS).order("created_at", { ascending: false });
      if (status) q = q.eq("approval_status", status);
      const { data, error } = await q;
      if (error) throw error;
      return withPrivate((data ?? []) as unknown as AdminSlot[]);
    },
  });
export const useAdminSlots = (status?: ApprovalStatus) => useQuery(adminSlotsQuery(status));

export type AdminTransaction = AdminReservation & {
  slot: { id: string; name: string; owner_id: string } | null;
  payment: AdminPayment | null;
};

export const adminTransactionsQuery = () =>
  queryOptions({
    queryKey: ["admin-transactions"],
    queryFn: async (): Promise<AdminTransaction[]> => {
      const { data, error } = await supabase
        .from("reservations")
        .select("*, slot:slots(id,name,owner_id)")
        .order("start_time", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<
        AdminReservation & { slot: { id: string; name: string; owner_id: string } | null }
      >;
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return [];
      const { data: pays } = await supabase
        .from("payments")
        .select("*")
        .in("reservation_id", ids)
        .order("created_at", { ascending: false });
      const map = new Map<string, AdminPayment>();
      for (const p of pays ?? []) if (!map.has(p.reservation_id)) map.set(p.reservation_id, p);
      return rows.map((r) => ({ ...r, payment: map.get(r.id) ?? null }));
    },
  });
export const useAdminTransactions = () => useQuery(adminTransactionsQuery());

export const adminDisputesQuery = () =>
  queryOptions({
    queryKey: ["admin-disputes"],
    queryFn: async (): Promise<AdminSupport[]> => {
      const { data, error } = await supabase
        .from("support_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
export const useAdminDisputes = () => useQuery(adminDisputesQuery());

export const adminReviewsQuery = () =>
  queryOptions({
    queryKey: ["admin-reviews"],
    queryFn: async (): Promise<AdminReview[]> => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .order("reported", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
export const useAdminReviews = () => useQuery(adminReviewsQuery());

export const adminPromosQuery = () =>
  queryOptions({
    queryKey: ["admin-promos"],
    queryFn: async (): Promise<PromoCode[]> => {
      const { data, error } = await supabase
        .from("promo_codes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
export const useAdminPromos = () => useQuery(adminPromosQuery());

export type AdminOverview = {
  users: number;
  hosts: number;
  slots: number;
  pendingSlots: number;
  openDisputes: number;
  reportedReviews: number;
  bookings30d: number;
  revenue30d: number;
  revenueLifetime: number;
};

export const adminOverviewQuery = () =>
  queryOptions({
    queryKey: ["admin-overview"],
    queryFn: async (): Promise<AdminOverview> => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [profiles, slots, disputes, issues, reviews, res] = await Promise.all([
        supabase.from("profiles").select("role"),
        supabase.from("slots").select("approval_status"),
        supabase.from("support_requests").select("status"),
        augDb.from("arrival_issues").select("status"),
        supabase.from("reviews").select("reported,hidden"),
        supabase.from("reservations").select("start_time,status,total_price,final_price"),
      ]);
      const rows = res.data ?? [];
      const paid = rows.filter((r) => billedAmount(r) > 0);
      const amount = billedAmount;
      return {
        users: profiles.data?.length ?? 0,
        hosts: (profiles.data ?? []).filter((p) => p.role === "landowner").length,
        slots: slots.data?.length ?? 0,
        pendingSlots: (slots.data ?? []).filter((s) => s.approval_status === "pending").length,
        openDisputes:
          (disputes.data ?? []).filter((d) => d.status === "open").length +
          (issues.data ?? []).filter((i) => i.status === "pending").length,
        reportedReviews: (reviews.data ?? []).filter((r) => r.reported && !r.hidden).length,
        bookings30d: paid.filter((r) => r.start_time >= since).length,
        revenue30d: paid.filter((r) => r.start_time >= since).reduce((s, r) => s + amount(r), 0),
        revenueLifetime: paid.reduce((s, r) => s + amount(r), 0),
      };
    },
  });
export const useAdminOverview = () => useQuery(adminOverviewQuery());

// ----- "Can't Park" reports (migration 0015, resolved by the rules in disputes-window.ts) -----

export type AdminArrivalIssue = AugmentedDatabase["public"]["Tables"]["arrival_issues"]["Row"];

/** A report joined with the booking it froze, so the queue shows who to pay and how much. */
export type AdminArrivalIssueView = AdminArrivalIssue & {
  slot_id: string | null;
  slot_name: string;
  owner_id: string | null;
  start_time: string | null;
  end_time: string | null;
  booking_status: string;
  total_price: number;
  /** What a full refund would send right now, in paise (0 when nothing is left to refund). */
  due_paise: number;
  /** True once the host's window has passed: from then on this is Usop's call. */
  owner_expired: boolean;
};

export const adminArrivalIssuesQuery = () =>
  queryOptions({
    queryKey: ["admin-arrival-issues"],
    queryFn: async (): Promise<AdminArrivalIssueView[]> => {
      // Admins may read every report (policy arrival_issues_select_admin), no server function needed.
      const { data: issues, error } = await augDb
        .from("arrival_issues")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = issues ?? [];
      if (!rows.length) return [];

      const ids = [...new Set(rows.map((r) => r.reservation_id))];
      const [{ data: bookings }, { data: payments }, { data: refunds }] = await Promise.all([
        supabase
          .from("reservations")
          .select("id,slot_id,start_time,end_time,status,total_price,slot:slots(name,owner_id)")
          .in("id", ids),
        supabase
          .from("payments")
          .select("reservation_id,amount_paise,status")
          .in("reservation_id", ids),
        supabase
          .from("refunds")
          .select("reservation_id,amount_paise,status")
          .in("reservation_id", ids),
      ]);
      const bookingOf = new Map((bookings ?? []).map((b) => [b.id, b]));

      return rows.map((issue) => {
        const booking = bookingOf.get(issue.reservation_id);
        return {
          ...issue,
          slot_id: booking?.slot_id ?? null,
          slot_name: booking?.slot?.name ?? "Deleted spot",
          owner_id: booking?.slot?.owner_id ?? null,
          start_time: booking?.start_time ?? null,
          end_time: booking?.end_time ?? null,
          booking_status: booking?.status ?? "unknown",
          total_price: Number(booking?.total_price ?? 0),
          due_paise: refundDuePaise(
            (payments ?? []).filter((p) => p.reservation_id === issue.reservation_id),
            (refunds ?? []).filter((r) => r.reservation_id === issue.reservation_id),
          ),
          owner_expired: !ownerCanResolve(issue),
        };
      });
    },
  });
export const useAdminArrivalIssues = () => useQuery(adminArrivalIssuesQuery());

export const PLATFORM_COMMISSION_RATE = 0.15;
