import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Profile = {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  role: "driver" | "landowner";
  verified: boolean;
  verification_status: "unverified" | "pending" | "approved" | "rejected";
  verification_note: string | null;
};

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export type Slot = {
  id: string;
  slot_type: Database["public"]["Enums"]["slot_type"];
  base_rate: number;
  lot_id: string | null;
  owner_id: string;
  name: string;
  approx_area: string;
  full_address?: string;
  lat: number;
  lng: number;
  hourly_rate: number;
  daily_rate: number;
  monthly_rate: number;
  status: "open" | "full";
  vehicle_type: "car" | "bike" | "both";
  vehicle_size_limit: string;
  access_instructions?: string;
  photos: string[];
  rating: number;
  covered: boolean;
  cctv: boolean;
  disabled_access: boolean;
  height_limit_cm: number | null;
  width_limit_cm: number | null;
  cancellation_policy: "flexible" | "moderate" | "strict";
  archived: boolean;
  approval_status?: "pending" | "approved" | "rejected";
  approval_note?: string | null;
  approved_at?: string | null;
  is_available?: boolean;
};

export type Vehicle = {
  id: string;
  user_id: string;
  plate: string;
  make: string | null;
  colour: string | null;
  is_default: boolean;
};

export type Reservation = {
  id: string;
  driver_id: string;
  slot_id: string;
  start_time: string;
  end_time: string;
  status: "upcoming" | "active" | "completed" | "cancelled";
  total_price: number;
  rate_type: "hourly" | "daily" | "monthly";
  vehicle_id: string | null;
  vehicle_plate: string | null;
  grand_total?: number | null;
  created_at?: string;
  /** Billed amount after cancellation/early end (net of refunds). */
  final_price?: number | null;
  pending_extension?: {
    minutes: number;
    new_end: string;
    extra: number;
    expires_at: string;
  } | null;
  arrived_at?: string | null;
  late_notified_at?: string | null;
};
export type Review = {
  id: string;
  slot_id: string;
  driver_id: string;
  rating: number;
  comment: string;
  reservation_id: string | null;
  owner_reply: string | null;
  owner_reply_at: string | null;
  created_at: string;
};

export type SlotAvailability = {
  id: string;
  slot_id: string;
  weekday: number;
  open_time: string;
  close_time: string;
  closed: boolean;
};

export type Message = {
  id: string;
  reservation_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read: boolean;
  created_at: string;
};

export type SupportRequest = {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: string;
  created_at: string;
};

export type PaymentMethod = {
  id: string;
  user_id: string;
  method: "card" | "upi";
  razorpay_token: string | null;
  network: string | null;
  last4: string | null;
  is_default: boolean;
  created_at: string;
};

export type Payment = {
  id: string;
  reservation_id: string;
  user_id: string;
  payment_method_id: string | null;
  amount_paise: number;
  currency: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  status: "created" | "authorized" | "captured" | "failed" | "refunded";
  created_at: string;
};

export const myVehiclesQuery = () =>
  queryOptions({
    queryKey: ["my-vehicles"],
    queryFn: async (): Promise<Vehicle[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Vehicle[];
    },
  });
export const useMyVehicles = () => useQuery(myVehiclesQuery());

export const profileQuery = () =>
  queryOptions({
    queryKey: ["profile"],
    queryFn: async (): Promise<Profile | null> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
export const useProfile = () => useQuery(profileQuery());

/** Public slot columns. Address + access instructions come from get_slots_private. */
export const SLOT_COLUMNS =
  "id, owner_id, name, approx_area, lat:public_lat, lng:public_lng, hourly_rate, daily_rate, monthly_rate, status, vehicle_type, vehicle_size_limit, photos, rating, created_at, covered, cctv, disabled_access, height_limit_cm, width_limit_cm, cancellation_policy, archived, lot_id, slot_type, base_rate, is_available, approval_status, approval_note, approved_at";

export type SlotPrivate = { slot_id: string; full_address: string; access_instructions: string };

export const slotsPrivateQuery = (ids: string[]) =>
  queryOptions({
    queryKey: ["slots-private", [...ids].sort().join(",")],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Record<string, SlotPrivate>> => {
      const { data, error } = await supabase.rpc("get_slots_private", { _slot_ids: ids });
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.slot_id, r as SlotPrivate]));
    },
  });
export const useSlotsPrivate = (ids: string[]) => useQuery(slotsPrivateQuery(ids));

/** Merge address + access instructions into slots the caller is allowed to see. */
export async function withPrivate<T extends { id: string }>(slots: T[]): Promise<T[]> {
  const ids = slots.map((s) => s.id);
  if (ids.length === 0) return slots;
  const { data } = await supabase.rpc("get_slots_private", { _slot_ids: ids });
  const map = new Map((data ?? []).map((r) => [r.slot_id, r]));
  return slots.map((s) => {
    const p = map.get(s.id);
    return p
      ? {
          ...s,
          full_address: p.full_address,
          access_instructions: p.access_instructions,
          lat: p.lat,
          lng: p.lng,
        }
      : s;
  });
}

export const slotsQuery = () =>
  queryOptions({
    queryKey: ["slots"],
    queryFn: async (): Promise<Slot[]> => {
      const { data, error } = await supabase
        .from("slots")
        .select(SLOT_COLUMNS)
        .eq("archived", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Slot[];
    },
  });
export const useSlots = () => useQuery(slotsQuery());

export const slotQuery = (id: string) =>
  queryOptions({
    queryKey: ["slot", id],
    queryFn: async (): Promise<Slot | null> => {
      const { data, error } = await supabase
        .from("slots")
        .select(SLOT_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const [merged] = await withPrivate([data as unknown as Slot]);
      return merged;
    },
  });
export const useSlot = (id: string) => useQuery(slotQuery(id));

export const mySlotsQuery = () =>
  queryOptions({
    queryKey: ["my-slots"],
    queryFn: async (): Promise<Slot[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("slots")
        .select(SLOT_COLUMNS)
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return withPrivate((data ?? []) as unknown as Slot[]);
    },
  });
export const useMySlots = () => useQuery(mySlotsQuery());

export const myReservationsQuery = () =>
  queryOptions({
    queryKey: ["my-reservations"],
    queryFn: async (): Promise<Array<Reservation & { slot: Slot | null }>> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("reservations")
        .select(`*, slot:slots(${SLOT_COLUMNS})`)
        .eq("driver_id", user.id)
        .order("start_time", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<Reservation & { slot: Slot | null }>;
      const slots = await withPrivate(rows.flatMap((r) => (r.slot ? [r.slot] : [])));
      const byId = new Map(slots.map((sl) => [sl.id, sl]));
      return rows.map((r) => ({ ...r, slot: r.slot ? (byId.get(r.slot.id) ?? r.slot) : null }));
    },
  });
export const useMyReservations = () => useQuery(myReservationsQuery());

export const ownerBookingsQuery = () =>
  queryOptions({
    queryKey: ["owner-bookings"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: slots } = await supabase
        .from("slots")
        .select("id, name")
        .eq("owner_id", user.id);
      const slotIds = (slots ?? []).map((s) => s.id);
      if (slotIds.length === 0) return [];
      const { data: reservations, error } = await supabase
        .from("reservations")
        .select("*")
        .in("slot_id", slotIds)
        .order("start_time", { ascending: false });
      if (error) throw error;
      const driverIds = [...new Set((reservations ?? []).map((r) => r.driver_id))];
      const { data: drivers } = await supabase
        .from("profiles")
        .select("user_id, name, phone")
        .in("user_id", driverIds);
      const driverMap = new Map((drivers ?? []).map((d) => [d.user_id, d]));
      const slotMap = new Map((slots ?? []).map((s) => [s.id, s]));
      return (reservations ?? []).map((r) => ({
        ...r,
        driver: driverMap.get(r.driver_id) ?? null,
        slot: slotMap.get(r.slot_id) ?? null,
      }));
    },
  });
export const useOwnerBookings = () => useQuery(ownerBookingsQuery());

export const reviewsQuery = (slotId: string) =>
  queryOptions({
    queryKey: ["reviews", slotId],
    queryFn: async (): Promise<Array<Review & { driver: Pick<Profile, "name"> | null }>> => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("slot_id", slotId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Review[];
      const driverIds = [...new Set(rows.map((r) => r.driver_id))];
      if (driverIds.length === 0) return rows.map((r) => ({ ...r, driver: null }));
      const { data: drivers } = await supabase.rpc("profile_briefs", { _user_ids: driverIds });
      const m = new Map(
        ((drivers ?? []) as Array<{ user_id: string; name: string }>).map((d) => [
          d.user_id,
          { name: d.name },
        ]),
      );
      return rows.map((r) => ({ ...r, driver: m.get(r.driver_id) ?? null }));
    },
  });
export const useReviews = (slotId: string) => useQuery(reviewsQuery(slotId));

export const notificationsQuery = () =>
  queryOptions({
    queryKey: ["notifications"],
    queryFn: async (): Promise<Notification[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });
export const useNotifications = () => useQuery(notificationsQuery());

export const ownerProfileQuery = (ownerId: string) =>
  queryOptions({
    queryKey: ["owner-profile", ownerId],
    queryFn: async (): Promise<Profile | null> => {
      if (!ownerId) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", ownerId)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as Profile | null;
      // Not a counterparty yet: fall back to the safe public brief (no phone).
      const { data: brief } = await supabase.rpc("profile_briefs", { _user_ids: [ownerId] });
      const row = ((brief ?? []) as Array<Partial<Profile>>)[0];
      return row ? (row as Profile) : null;
    },
  });
export const useOwnerProfile = (ownerId: string) => useQuery(ownerProfileQuery(ownerId));

// Favorites
export const myFavoritesQuery = () =>
  queryOptions({
    queryKey: ["my-favorites"],
    queryFn: async (): Promise<Array<{ id: string; slot_id: string; slot: Slot | null }>> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("favorites")
        .select(`id, slot_id, slot:slots(${SLOT_COLUMNS})`)
        .eq("driver_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ id: string; slot_id: string; slot: Slot | null }>;
    },
  });
export const useMyFavorites = () => useQuery(myFavoritesQuery());

// Messages for a reservation
export const messagesQuery = (reservationId: string) =>
  queryOptions({
    queryKey: ["messages", reservationId],
    queryFn: async (): Promise<Message[]> => {
      if (!reservationId) return [];
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("reservation_id", reservationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });
export const useMessages = (reservationId: string) => useQuery(messagesQuery(reservationId));

// Support requests
export const mySupportQuery = () =>
  queryOptions({
    queryKey: ["my-support"],
    queryFn: async (): Promise<SupportRequest[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("support_requests")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SupportRequest[];
    },
  });
export const useMySupport = () => useQuery(mySupportQuery());

// Reservation detail (used by messages page)
export const reservationQuery = (id: string) =>
  queryOptions({
    queryKey: ["reservation", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("reservations")
        .select(`*, slot:slots(${SLOT_COLUMNS})`)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      const row = data as unknown as (Reservation & { slot: Slot | null }) | null;
      if (row?.slot) row.slot = (await withPrivate([row.slot]))[0];
      return row;
    },
  });
export const useReservation = (id: string) => useQuery(reservationQuery(id));

export type LotOccupancy = {
  id: string;
  tier: Database["public"]["Enums"]["lot_tier"];
  total_slots: number;
  occupied_slots: number;
};

export const lotOccupancyQuery = () =>
  queryOptions({
    queryKey: ["lot-occupancy"],
    queryFn: async (): Promise<Record<string, LotOccupancy>> => {
      const { data, error } = await supabase
        .from("parking_lots")
        .select("id, tier, total_slots, occupied_slots");
      if (error) throw error;
      const map: Record<string, LotOccupancy> = {};
      for (const lot of data ?? []) map[lot.id] = lot as LotOccupancy;
      return map;
    },
    staleTime: 60_000,
  });
export const useLotOccupancy = () => useQuery(lotOccupancyQuery());

export const myPaymentMethodsQuery = () =>
  queryOptions({
    queryKey: ["my-payment-methods"],
    queryFn: async (): Promise<PaymentMethod[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("payment_methods")
        .select("id, user_id, method, razorpay_token, network, last4, is_default, created_at")
        .eq("user_id", user.id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PaymentMethod[];
    },
  });
export const useMyPaymentMethods = () => useQuery(myPaymentMethodsQuery());

export const reservationPaymentStatusQuery = (reservationId: string) =>
  queryOptions({
    queryKey: ["reservation-payment", reservationId],
    queryFn: async (): Promise<Payment | null> => {
      if (!reservationId) return null;
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, reservation_id, user_id, payment_method_id, amount_paise, currency, razorpay_order_id, razorpay_payment_id, status, created_at",
        )
        .eq("reservation_id", reservationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as Payment | null;
    },
  });
export const useReservationPaymentStatus = (reservationId: string) =>
  useQuery(reservationPaymentStatusQuery(reservationId));

export const slotAvailabilityQuery = (slotId: string) =>
  queryOptions({
    queryKey: ["slot-availability", slotId],
    queryFn: async (): Promise<SlotAvailability[]> => {
      const { data, error } = await supabase
        .from("slot_availability")
        .select("id, slot_id, weekday, open_time, close_time, closed")
        .eq("slot_id", slotId)
        .order("weekday");
      if (error) throw error;
      return (data ?? []) as SlotAvailability[];
    },
    enabled: !!slotId,
  });
export const useSlotAvailability = (slotId: string) => useQuery(slotAvailabilityQuery(slotId));
