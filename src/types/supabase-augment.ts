import type { Database as BaseDatabase } from "@/integrations/supabase/types";

export type Database = BaseDatabase & {
  public: {
    Tables: {
      slots: {
        Row: BaseDatabase["public"]["Tables"]["slots"]["Row"] & {
          slot_type: "standard_car" | "compact_car" | "suv_large" | "two_wheeler" | "ev_charging" | "premium_covered" | "valet_handicapped";
          base_rate: number;
          lot_id: string | null;
        };
        Insert: BaseDatabase["public"]["Tables"]["slots"]["Insert"] & {
          slot_type?: "standard_car" | "compact_car" | "suv_large" | "two_wheeler" | "ev_charging" | "premium_covered" | "valet_handicapped";
          base_rate?: number;
          lot_id?: string | null;
        };
        Update: BaseDatabase["public"]["Tables"]["slots"]["Update"] & {
          slot_type?: "standard_car" | "compact_car" | "suv_large" | "two_wheeler" | "ev_charging" | "premium_covered" | "valet_handicapped";
          base_rate?: number;
          lot_id?: string | null;
        };
      };
      parking_lots: {
        Row: {
          id: string;
          name: string;
          owner_id: string;
          lat: number;
          lng: number;
          tier: "T1" | "T2" | "T3" | "T4";
          total_slots: number;
          occupied_slots: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          owner_id: string;
          lat: number;
          lng: number;
          tier?: "T1" | "T2" | "T3" | "T4";
          total_slots?: number;
          occupied_slots?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          owner_id?: string;
          lat?: number;
          lng?: number;
          tier?: "T1" | "T2" | "T3" | "T4";
          total_slots?: number;
          occupied_slots?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      public_holidays: {
        Row: {
          id: string;
          date: string;
          name: string;
          year: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          date: string;
          name: string;
          year: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          date?: string;
          name?: string;
          year?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      payment_methods: {
        Row: {
          id: string;
          user_id: string;
          method: "card" | "upi";
          razorpay_token: string | null;
          network: string | null;
          last4: string | null;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          method: "card" | "upi";
          razorpay_token?: string | null;
          network?: string | null;
          last4?: string | null;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          method?: "card" | "upi";
          razorpay_token?: string | null;
          network?: string | null;
          last4?: string | null;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      owner_documents: {
        Row: {
          id: string;
          owner_id: string;
          kind: "id_proof" | "ownership_proof";
          storage_path: string;
          status: "pending" | "approved" | "rejected";
          note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          kind: "id_proof" | "ownership_proof";
          storage_path: string;
          status?: "pending" | "approved" | "rejected";
          note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          kind?: "id_proof" | "ownership_proof";
          storage_path?: string;
          status?: "pending" | "approved" | "rejected";
          note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "owner_documents_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "owner_documents_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      payments: {
        Row: {
          id: string;
          reservation_id: string;
          user_id: string;
          payment_method_id: string | null;
          amount_paise: number;
          currency: string;
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          razorpay_signature: string | null;
          status: "created" | "authorized" | "captured" | "failed" | "refunded";
          gateway_response: import("@/integrations/supabase/types").Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          reservation_id: string;
          user_id: string;
          payment_method_id?: string | null;
          amount_paise: number;
          currency?: string;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          razorpay_signature?: string | null;
          status?: "created" | "authorized" | "captured" | "failed" | "refunded";
          gateway_response?: import("@/integrations/supabase/types").Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          reservation_id?: string;
          user_id?: string;
          payment_method_id?: string | null;
          amount_paise?: number;
          currency?: string;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          razorpay_signature?: string | null;
          status?: "created" | "authorized" | "captured" | "failed" | "refunded";
          gateway_response?: import("@/integrations/supabase/types").Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_payment_method_id_fkey";
            columns: ["payment_method_id"];
            isOneToOne: false;
            referencedRelation: "payment_methods";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_reservation_id_fkey";
            columns: ["reservation_id"];
            isOneToOne: false;
            referencedRelation: "reservations";
            referencedColumns: ["id"];
          }
        ];
      };
      reservations: {
        // Migration 0012 adds arrival tracking; coordinates are never collected.
        Row: BaseDatabase["public"]["Tables"]["reservations"]["Row"] & {
          arrived_at: string | null;
          late_notified_at: string | null;
        };
        Insert: BaseDatabase["public"]["Tables"]["reservations"]["Insert"] & {
          arrived_at?: string | null;
          late_notified_at?: string | null;
        };
        Update: BaseDatabase["public"]["Tables"]["reservations"]["Update"] & {
          arrived_at?: string | null;
          late_notified_at?: string | null;
        };
      };
    };
    Enums: {
      slot_type: "standard_car" | "compact_car" | "suv_large" | "two_wheeler" | "ev_charging" | "premium_covered" | "valet_handicapped";
      lot_tier: "T1" | "T2" | "T3" | "T4";
    } & BaseDatabase["public"]["Enums"];
  };
};
