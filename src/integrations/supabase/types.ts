export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      favorites: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          slot_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          slot_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          key: string
          response: Json | null
          scope: string
          status_code: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          response?: Json | null
          scope: string
          status_code?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          key?: string
          response?: Json | null
          scope?: string
          status_code?: number | null
          user_id?: string
        }
        Relationships: []
      }
      internal_tokens: {
        Row: {
          created_at: string
          name: string
          token_sha256: string
        }
        Insert: {
          created_at?: string
          name: string
          token_sha256: string
        }
        Update: {
          created_at?: string
          name?: string
          token_sha256?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          read: boolean
          recipient_id: string
          reservation_id: string
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read?: boolean
          recipient_id: string
          reservation_id: string
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read?: boolean
          recipient_id?: string
          reservation_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      parking_lots: {
        Row: {
          created_at: string
          id: string
          lat: number
          lng: number
          name: string
          occupied_slots: number
          owner_id: string
          tier: Database["public"]["Enums"]["lot_tier"]
          total_slots: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lat: number
          lng: number
          name: string
          occupied_slots?: number
          owner_id: string
          tier?: Database["public"]["Enums"]["lot_tier"]
          total_slots?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lat?: number
          lng?: number
          name?: string
          occupied_slots?: number
          owner_id?: string
          tier?: Database["public"]["Enums"]["lot_tier"]
          total_slots?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          actor: string
          amount_paise: number | null
          created_at: string
          data: Json | null
          id: string
          kind: string
          payment_id: string | null
          reason: string | null
          refund_id: string | null
          reservation_id: string | null
          user_id: string | null
        }
        Insert: {
          actor?: string
          amount_paise?: number | null
          created_at?: string
          data?: Json | null
          id?: string
          kind: string
          payment_id?: string | null
          reason?: string | null
          refund_id?: string | null
          reservation_id?: string | null
          user_id?: string | null
        }
        Update: {
          actor?: string
          amount_paise?: number | null
          created_at?: string
          data?: Json | null
          id?: string
          kind?: string
          payment_id?: string | null
          reason?: string | null
          refund_id?: string | null
          reservation_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          last4: string | null
          method: string
          network: string | null
          razorpay_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          last4?: string | null
          method: string
          network?: string | null
          razorpay_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          last4?: string | null
          method?: string
          network?: string | null
          razorpay_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_paise: number
          created_at: string
          currency: string
          gateway_response: Json | null
          id: string
          payment_method_id: string | null
          purpose: string
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          razorpay_signature: string | null
          refund_reason: string | null
          refunded_amount_paise: number
          refunded_at: string | null
          reservation_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          currency?: string
          gateway_response?: Json | null
          id?: string
          payment_method_id?: string | null
          purpose?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          refund_reason?: string | null
          refunded_amount_paise?: number
          refunded_at?: string | null
          reservation_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          currency?: string
          gateway_response?: Json | null
          id?: string
          payment_method_id?: string | null
          purpose?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          refund_reason?: string | null
          refunded_amount_paise?: number
          refunded_at?: string | null
          reservation_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          name: string
          phone: string
          role: Database["public"]["Enums"]["user_role"]
          suspended: boolean
          suspended_at: string | null
          suspended_reason: string | null
          user_id: string
          verification_note: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          verified: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          phone?: string
          role?: Database["public"]["Enums"]["user_role"]
          suspended?: boolean
          suspended_at?: string | null
          suspended_reason?: string | null
          user_id: string
          verification_note?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          phone?: string
          role?: Database["public"]["Enums"]["user_role"]
          suspended?: boolean
          suspended_at?: string | null
          suspended_reason?: string | null
          user_id?: string
          verification_note?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified?: boolean
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          description: string
          discount_type: string
          discount_value: number
          ends_at: string | null
          id: string
          max_discount: number | null
          min_spend: number
          per_user_limit: number
          starts_at: string
          updated_at: string
          usage_limit: number | null
          used_count: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          description?: string
          discount_type?: string
          discount_value?: number
          ends_at?: string | null
          id?: string
          max_discount?: number | null
          min_spend?: number
          per_user_limit?: number
          starts_at?: string
          updated_at?: string
          usage_limit?: number | null
          used_count?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string
          discount_type?: string
          discount_value?: number
          ends_at?: string | null
          id?: string
          max_discount?: number | null
          min_spend?: number
          per_user_limit?: number
          starts_at?: string
          updated_at?: string
          usage_limit?: number | null
          used_count?: number
        }
        Relationships: []
      }
      promo_redemptions: {
        Row: {
          created_at: string
          discount_amount: number
          id: string
          promo_id: string
          reservation_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          discount_amount?: number
          id?: string
          promo_id: string
          reservation_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          discount_amount?: number
          id?: string
          promo_id?: string
          reservation_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_redemptions_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      public_holidays: {
        Row: {
          created_at: string
          date: string
          id: string
          name: string
          year: number
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          name: string
          year: number
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          name?: string
          year?: number
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          user_id: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          user_id: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          actor: string
          amount_paise: number
          attempts: number
          created_at: string
          gst_paise: number
          id: string
          idempotency_key: string
          last_error: string | null
          next_attempt_at: string
          payment_id: string
          razorpay_refund_id: string | null
          reason: string
          reservation_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          actor?: string
          amount_paise: number
          attempts?: number
          created_at?: string
          gst_paise?: number
          id?: string
          idempotency_key: string
          last_error?: string | null
          next_attempt_at?: string
          payment_id: string
          razorpay_refund_id?: string | null
          reason: string
          reservation_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          actor?: string
          amount_paise?: number
          attempts?: number
          created_at?: string
          gst_paise?: number
          id?: string
          idempotency_key?: string
          last_error?: string | null
          next_attempt_at?: string
          payment_id?: string
          razorpay_refund_id?: string | null
          reason?: string
          reservation_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          amount_charged: number | null
          base_rate: number | null
          created_at: string
          discount_amount: number
          driver_id: string
          end_time: string
          extended_minutes: number
          final_price: number | null
          final_price_per_hour: number | null
          grand_total: number | null
          gst_amount: number | null
          id: string
          payment_expires_at: string | null
          pending_extension: Json | null
          price_breakdown: Json | null
          promo_code: string | null
          rate_type: Database["public"]["Enums"]["rate_type"]
          slot_id: string
          start_time: string
          status: Database["public"]["Enums"]["reservation_status"]
          subtotal_amount: number | null
          total_price: number
          vehicle_id: string | null
          vehicle_plate: string | null
        }
        Insert: {
          amount_charged?: number | null
          base_rate?: number | null
          created_at?: string
          discount_amount?: number
          driver_id: string
          end_time: string
          extended_minutes?: number
          final_price?: number | null
          final_price_per_hour?: number | null
          grand_total?: number | null
          gst_amount?: number | null
          id?: string
          payment_expires_at?: string | null
          pending_extension?: Json | null
          price_breakdown?: Json | null
          promo_code?: string | null
          rate_type?: Database["public"]["Enums"]["rate_type"]
          slot_id: string
          start_time: string
          status?: Database["public"]["Enums"]["reservation_status"]
          subtotal_amount?: number | null
          total_price?: number
          vehicle_id?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          amount_charged?: number | null
          base_rate?: number | null
          created_at?: string
          discount_amount?: number
          driver_id?: string
          end_time?: string
          extended_minutes?: number
          final_price?: number | null
          final_price_per_hour?: number | null
          grand_total?: number | null
          gst_amount?: number | null
          id?: string
          payment_expires_at?: string | null
          pending_extension?: Json | null
          price_breakdown?: Json | null
          promo_code?: string | null
          rate_type?: Database["public"]["Enums"]["rate_type"]
          slot_id?: string
          start_time?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          subtotal_amount?: number | null
          total_price?: number
          vehicle_id?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      review_reports: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          review_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          review_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          review_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_reports_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string
          created_at: string
          driver_id: string
          hidden: boolean
          id: string
          moderation_note: string | null
          owner_reply: string | null
          owner_reply_at: string | null
          rating: number
          report_count: number
          reported: boolean
          reservation_id: string | null
          slot_id: string
        }
        Insert: {
          comment?: string
          created_at?: string
          driver_id: string
          hidden?: boolean
          id?: string
          moderation_note?: string | null
          owner_reply?: string | null
          owner_reply_at?: string | null
          rating: number
          report_count?: number
          reported?: boolean
          reservation_id?: string | null
          slot_id: string
        }
        Update: {
          comment?: string
          created_at?: string
          driver_id?: string
          hidden?: boolean
          id?: string
          moderation_note?: string | null
          owner_reply?: string | null
          owner_reply_at?: string | null
          rating?: number
          report_count?: number
          reported?: boolean
          reservation_id?: string | null
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_availability: {
        Row: {
          close_time: string
          closed: boolean
          created_at: string
          id: string
          open_time: string
          slot_id: string
          weekday: number
        }
        Insert: {
          close_time?: string
          closed?: boolean
          created_at?: string
          id?: string
          open_time?: string
          slot_id: string
          weekday: number
        }
        Update: {
          close_time?: string
          closed?: boolean
          created_at?: string
          id?: string
          open_time?: string
          slot_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "slot_availability_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_notify: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          slot_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          slot_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_notify_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      slots: {
        Row: {
          access_instructions: string
          approval_note: string | null
          approval_status: Database["public"]["Enums"]["approval_status"]
          approved_at: string | null
          approx_area: string
          approx_lat: number | null
          approx_lng: number | null
          approx_seed: string
          archived: boolean
          base_rate: number
          cancellation_policy: string
          cctv: boolean
          covered: boolean
          created_at: string
          daily_rate: number
          disabled_access: boolean
          full_address: string
          height_limit_cm: number | null
          hourly_rate: number
          id: string
          is_available: boolean
          lat: number
          lng: number
          lot_id: string | null
          monthly_rate: number
          name: string
          owner_id: string
          photos: string[]
          public_lat: number | null
          public_lng: number | null
          rating: number
          slot_type: Database["public"]["Enums"]["slot_type"]
          status: Database["public"]["Enums"]["slot_status"]
          vehicle_size_limit: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
          width_limit_cm: number | null
        }
        Insert: {
          access_instructions?: string
          approval_note?: string | null
          approval_status?: Database["public"]["Enums"]["approval_status"]
          approved_at?: string | null
          approx_area: string
          approx_lat?: number | null
          approx_lng?: number | null
          approx_seed?: string
          archived?: boolean
          base_rate?: number
          cancellation_policy?: string
          cctv?: boolean
          covered?: boolean
          created_at?: string
          daily_rate?: number
          disabled_access?: boolean
          full_address: string
          height_limit_cm?: number | null
          hourly_rate?: number
          id?: string
          is_available?: boolean
          lat: number
          lng: number
          lot_id?: string | null
          monthly_rate?: number
          name: string
          owner_id: string
          photos?: string[]
          public_lat?: number | null
          public_lng?: number | null
          rating?: number
          slot_type?: Database["public"]["Enums"]["slot_type"]
          status?: Database["public"]["Enums"]["slot_status"]
          vehicle_size_limit?: string
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
          width_limit_cm?: number | null
        }
        Update: {
          access_instructions?: string
          approval_note?: string | null
          approval_status?: Database["public"]["Enums"]["approval_status"]
          approved_at?: string | null
          approx_area?: string
          approx_lat?: number | null
          approx_lng?: number | null
          approx_seed?: string
          archived?: boolean
          base_rate?: number
          cancellation_policy?: string
          cctv?: boolean
          covered?: boolean
          created_at?: string
          daily_rate?: number
          disabled_access?: boolean
          full_address?: string
          height_limit_cm?: number | null
          hourly_rate?: number
          id?: string
          is_available?: boolean
          lat?: number
          lng?: number
          lot_id?: string | null
          monthly_rate?: number
          name?: string
          owner_id?: string
          photos?: string[]
          public_lat?: number | null
          public_lng?: number | null
          rating?: number
          slot_type?: Database["public"]["Enums"]["slot_type"]
          status?: Database["public"]["Enums"]["slot_status"]
          vehicle_size_limit?: string
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
          width_limit_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "slots_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "parking_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      support_requests: {
        Row: {
          admin_note: string | null
          category: string
          created_at: string
          id: string
          message: string
          resolved_at: string | null
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          category?: string
          created_at?: string
          id?: string
          message: string
          resolved_at?: string | null
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          category?: string
          created_at?: string
          id?: string
          message?: string
          resolved_at?: string | null
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          colour: string | null
          created_at: string
          id: string
          is_default: boolean
          make: string | null
          plate: string
          user_id: string
        }
        Insert: {
          colour?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          make?: string | null
          plate: string
          user_id: string
        }
        Update: {
          colour?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          make?: string | null
          plate?: string
          user_id?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          event: string
          event_id: string
          received_at: string
        }
        Insert: {
          event: string
          event_id: string
          received_at?: string
        }
        Update: {
          event?: string
          event_id?: string
          received_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_broadcast_notification: {
        Args: {
          _body: string
          _link?: string
          _target?: string
          _title: string
        }
        Returns: number
      }
      advance_reservations: { Args: never; Returns: Json }
      apply_extension: { Args: { _id: string }; Returns: string }
      claim_payment: {
        Args: {
          _next: string
          _payment_id: string
          _response: Json
          _rzp_payment_id: string
        }
        Returns: boolean
      }
      expire_unpaid_reservations: { Args: never; Returns: number }
      get_slots_private: {
        Args: { _slot_ids: string[] }
        Returns: {
          access_instructions: string
          full_address: string
          lat: number
          lng: number
          slot_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_privileged: { Args: never; Returns: boolean }
      log_payment_event: {
        Args: {
          _actor: string
          _amount: number
          _data?: Json
          _kind: string
          _payment_id: string
          _reason: string
          _refund_id: string
          _reservation_id: string
        }
        Returns: undefined
      }
      payment_rank: { Args: { _s: string }; Returns: number }
      profile_briefs: {
        Args: { _user_ids: string[] }
        Returns: {
          name: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
          verified: boolean
        }[]
      }
      redeem_promo: {
        Args: {
          _code: string
          _reservation_id: string
          _subtotal: number
          _user_id: string
        }
        Returns: number
      }
      release_promo: { Args: { _reservation_id: string }; Returns: undefined }
      report_review: { Args: { _review_id: string }; Returns: undefined }
      request_refund: {
        Args: {
          _actor: string
          _amount: number
          _gst: number
          _key: string
          _payment_id: string
          _reason: string
          _reservation_id: string
        }
        Returns: {
          created: boolean
          refund_id: string
        }[]
      }
      reservation_balance: { Args: { _id: string }; Returns: number }
      reservation_has_captured_payment: {
        Args: { _id: string }
        Returns: boolean
      }
      rl_hit: {
        Args: {
          _bucket: string
          _limit: number
          _user_id: string
          _window_s: number
        }
        Returns: boolean
      }
      set_pending_extension: {
        Args: { _ext: Json; _id: string }
        Returns: boolean
      }
      slot_open_booking_count: { Args: { _slot_id: string }; Returns: number }
      verify_internal_token: {
        Args: { _name: string; _token: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      approval_status: "pending" | "approved" | "rejected"
      lot_tier: "T1" | "T2" | "T3" | "T4"
      rate_type: "hourly" | "daily" | "monthly"
      reservation_status: "upcoming" | "active" | "completed" | "cancelled"
      slot_status: "open" | "full"
      slot_type:
        | "standard_car"
        | "compact_car"
        | "suv"
        | "two_wheeler"
        | "ev"
        | "premium_covered"
        | "valet_handicapped"
      user_role: "driver" | "landowner"
      vehicle_type: "car" | "bike" | "both"
      verification_status: "unverified" | "pending" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      approval_status: ["pending", "approved", "rejected"],
      lot_tier: ["T1", "T2", "T3", "T4"],
      rate_type: ["hourly", "daily", "monthly"],
      reservation_status: ["upcoming", "active", "completed", "cancelled"],
      slot_status: ["open", "full"],
      slot_type: [
        "standard_car",
        "compact_car",
        "suv",
        "two_wheeler",
        "ev",
        "premium_covered",
        "valet_handicapped",
      ],
      user_role: ["driver", "landowner"],
      vehicle_type: ["car", "bike", "both"],
      verification_status: ["unverified", "pending", "approved", "rejected"],
    },
  },
} as const
