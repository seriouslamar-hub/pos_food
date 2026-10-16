export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_staff_id: string | null
          after: Json | null
          approver_staff_id: string | null
          before: Json | null
          branch_id: string | null
          created_at: string
          device_id: string | null
          entity: string
          entity_id: string | null
          id: number
          is_offline: boolean
          reason: string | null
        }
        Insert: {
          action: string
          actor_staff_id?: string | null
          after?: Json | null
          approver_staff_id?: string | null
          before?: Json | null
          branch_id?: string | null
          created_at?: string
          device_id?: string | null
          entity: string
          entity_id?: string | null
          id?: never
          is_offline?: boolean
          reason?: string | null
        }
        Update: {
          action?: string
          actor_staff_id?: string | null
          after?: Json | null
          approver_staff_id?: string | null
          before?: Json | null
          branch_id?: string | null
          created_at?: string
          device_id?: string | null
          entity?: string
          entity_id?: string | null
          id?: never
          is_offline?: boolean
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_approver_staff_id_fkey"
            columns: ["approver_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_menu_items: {
        Row: {
          branch_id: string
          is_available: boolean
          menu_item_id: string
          price_override: number | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          is_available?: boolean
          menu_item_id: string
          price_override?: number | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          is_available?: boolean
          menu_item_id?: string
          price_override?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_menu_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_menu_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_modifiers: {
        Row: {
          branch_id: string
          is_available: boolean
          modifier_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          is_available?: boolean
          modifier_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          is_available?: boolean
          modifier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_modifiers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          created_at: string
          currency_code: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          phone: string | null
          receipt_footer: string | null
          receipt_header: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          currency_code: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          phone?: string | null
          receipt_footer?: string | null
          receipt_header?: string | null
          timezone: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          currency_code?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          phone?: string | null
          receipt_footer?: string | null
          receipt_header?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      business_days: {
        Row: {
          branch_id: string
          business_date: string
          closed_at: string | null
          closed_by: string | null
          id: string
          opened_at: string
          opened_by: string | null
          status: Database["public"]["Enums"]["business_day_status"]
          z_report: Json | null
        }
        Insert: {
          branch_id: string
          business_date: string
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          status?: Database["public"]["Enums"]["business_day_status"]
          z_report?: Json | null
        }
        Update: {
          branch_id?: string
          business_date?: string
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          status?: Database["public"]["Enums"]["business_day_status"]
          z_report?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "business_days_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_days_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_days_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          approved_by: string | null
          branch_id: string
          client_created_at: string | null
          created_at: string
          device_id: string | null
          id: string
          pos_session_id: string | null
          reason: string | null
          shift_id: string
          staff_id: string
          type: Database["public"]["Enums"]["cash_movement_type"]
        }
        Insert: {
          amount: number
          approved_by?: string | null
          branch_id: string
          client_created_at?: string | null
          created_at?: string
          device_id?: string | null
          id: string
          pos_session_id?: string | null
          reason?: string | null
          shift_id: string
          staff_id: string
          type: Database["public"]["Enums"]["cash_movement_type"]
        }
        Update: {
          amount?: number
          approved_by?: string | null
          branch_id?: string
          client_created_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          pos_session_id?: string | null
          reason?: string | null
          shift_id?: string
          staff_id?: string
          type?: Database["public"]["Enums"]["cash_movement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_pos_session_id_fkey"
            columns: ["pos_session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          colour: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          colour?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          colour?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      combo_slot_options: {
        Row: {
          is_default: boolean
          menu_item_id: string
          slot_id: string
          sort_order: number
          upcharge: number
        }
        Insert: {
          is_default?: boolean
          menu_item_id: string
          slot_id: string
          sort_order?: number
          upcharge?: number
        }
        Update: {
          is_default?: boolean
          menu_item_id?: string
          slot_id?: string
          sort_order?: number
          upcharge?: number
        }
        Relationships: [
          {
            foreignKeyName: "combo_slot_options_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_slot_options_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "combo_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_slots: {
        Row: {
          combo_item_id: string
          created_at: string
          id: string
          name: string
          required: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          combo_item_id: string
          created_at?: string
          id?: string
          name: string
          required?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          combo_item_id?: string
          created_at?: string
          id?: string
          name?: string
          required?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "combo_slots_combo_item_id_fkey"
            columns: ["combo_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      device_setup_codes: {
        Row: {
          code_hash: string
          created_at: string
          created_by_staff_id: string | null
          device_id: string
          expires_at: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          created_by_staff_id?: string | null
          device_id: string
          expires_at: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          created_by_staff_id?: string | null
          device_id?: string
          expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_setup_codes_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_setup_codes_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          auth_user_id: string | null
          branch_id: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          last_seen_at: string | null
          name: string
          pending_sync: number | null
          pending_sync_at: string | null
          station: string | null
          type: Database["public"]["Enums"]["device_type"]
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          branch_id: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          name: string
          pending_sync?: number | null
          pending_sync_at?: string | null
          station?: string | null
          type: Database["public"]["Enums"]["device_type"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          branch_id?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          name?: string
          pending_sync?: number | null
          pending_sync_at?: string | null
          station?: string | null
          type?: Database["public"]["Enums"]["device_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      item_modifier_groups: {
        Row: {
          menu_item_id: string
          modifier_group_id: string
          sort_order: number
        }
        Insert: {
          menu_item_id: string
          modifier_group_id: string
          sort_order?: number
        }
        Update: {
          menu_item_id?: string
          modifier_group_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_modifier_groups_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_modifier_groups_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      kds_stations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          base_price: number
          category_id: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          kds_station_id: string | null
          name: string
          short_name: string | null
          sort_order: number
          tax_category: string
          type: Database["public"]["Enums"]["menu_item_type"]
          updated_at: string
        }
        Insert: {
          base_price: number
          category_id: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          kds_station_id?: string | null
          name: string
          short_name?: string | null
          sort_order?: number
          tax_category?: string
          type?: Database["public"]["Enums"]["menu_item_type"]
          updated_at?: string
        }
        Update: {
          base_price?: number
          category_id?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          kds_station_id?: string | null
          name?: string
          short_name?: string | null
          sort_order?: number
          tax_category?: string
          type?: Database["public"]["Enums"]["menu_item_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_kds_station_id_fkey"
            columns: ["kds_station_id"]
            isOneToOne: false
            referencedRelation: "kds_stations"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          max_select: number
          min_select: number
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_select?: number
          min_select?: number
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_select?: number
          min_select?: number
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      modifiers: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_active: boolean
          kds_station_id: string | null
          name: string
          price_delta: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_active?: boolean
          kds_station_id?: string | null
          name: string
          price_delta?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_active?: boolean
          kds_station_id?: string | null
          name?: string
          price_delta?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifiers_kds_station_id_fkey"
            columns: ["kds_station_id"]
            isOneToOne: false
            referencedRelation: "kds_stations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_counters: {
        Row: {
          branch_id: string
          counter_date: string
          last_number: number
        }
        Insert: {
          branch_id: string
          counter_date: string
          last_number?: number
        }
        Update: {
          branch_id?: string
          counter_date?: string
          last_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_counters_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          approved_by: string | null
          branch_id: string
          combo_slot_name: string | null
          created_at: string
          discount: Json | null
          id: string
          kds_station_id: string | null
          line_discount: number
          line_subtotal: number
          line_tax: number
          line_total: number
          menu_item_id: string
          modifiers: Json
          name_snapshot: string
          notes: string | null
          order_discount_share: number
          order_id: string
          parent_item_id: string | null
          price_approved_by: string | null
          price_override_from: number | null
          price_override_reason: string | null
          quantity: number
          refund_id: string | null
          refunded_at: string | null
          short_name_snapshot: string
          sort_order: number
          status: Database["public"]["Enums"]["order_item_status"]
          taxes: Json
          unit_price: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          approved_by?: string | null
          branch_id: string
          combo_slot_name?: string | null
          created_at?: string
          discount?: Json | null
          id: string
          kds_station_id?: string | null
          line_discount?: number
          line_subtotal?: number
          line_tax?: number
          line_total?: number
          menu_item_id: string
          modifiers?: Json
          name_snapshot: string
          notes?: string | null
          order_discount_share?: number
          order_id: string
          parent_item_id?: string | null
          price_approved_by?: string | null
          price_override_from?: number | null
          price_override_reason?: string | null
          quantity: number
          refund_id?: string | null
          refunded_at?: string | null
          short_name_snapshot: string
          sort_order?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          taxes?: Json
          unit_price: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          approved_by?: string | null
          branch_id?: string
          combo_slot_name?: string | null
          created_at?: string
          discount?: Json | null
          id?: string
          kds_station_id?: string | null
          line_discount?: number
          line_subtotal?: number
          line_tax?: number
          line_total?: number
          menu_item_id?: string
          modifiers?: Json
          name_snapshot?: string
          notes?: string | null
          order_discount_share?: number
          order_id?: string
          parent_item_id?: string | null
          price_approved_by?: string | null
          price_override_from?: number | null
          price_override_reason?: string | null
          quantity?: number
          refund_id?: string | null
          refunded_at?: string | null
          short_name_snapshot?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          taxes?: Json
          unit_price?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_kds_station_id_fkey"
            columns: ["kds_station_id"]
            isOneToOne: false
            referencedRelation: "kds_stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_price_approved_by_fkey"
            columns: ["price_approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          branch_id: string
          business_date: string
          channel: Database["public"]["Enums"]["order_channel"]
          client_created_at: string | null
          collected_at: string | null
          created_at: string
          customer_id: string | null
          customer_phone: string | null
          delivery_address: string | null
          device_id: string | null
          discount: Json | null
          discount_approved_by: string | null
          discount_total: number
          id: string
          is_offline: boolean
          notes: string | null
          offline_difference: number | null
          order_number: string
          order_type: Database["public"]["Enums"]["order_type"]
          paid_at: string | null
          pos_session_id: string | null
          ready_at: string | null
          sent_to_kitchen_at: string | null
          shift_id: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax_total: number
          total: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          business_date: string
          channel?: Database["public"]["Enums"]["order_channel"]
          client_created_at?: string | null
          collected_at?: string | null
          created_at?: string
          customer_id?: string | null
          customer_phone?: string | null
          delivery_address?: string | null
          device_id?: string | null
          discount?: Json | null
          discount_approved_by?: string | null
          discount_total?: number
          id: string
          is_offline?: boolean
          notes?: string | null
          offline_difference?: number | null
          order_number: string
          order_type?: Database["public"]["Enums"]["order_type"]
          paid_at?: string | null
          pos_session_id?: string | null
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          shift_id?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          business_date?: string
          channel?: Database["public"]["Enums"]["order_channel"]
          client_created_at?: string | null
          collected_at?: string | null
          created_at?: string
          customer_id?: string | null
          customer_phone?: string | null
          delivery_address?: string | null
          device_id?: string | null
          discount?: Json | null
          discount_approved_by?: string | null
          discount_total?: number
          id?: string
          is_offline?: boolean
          notes?: string | null
          offline_difference?: number | null
          order_number?: string
          order_type?: Database["public"]["Enums"]["order_type"]
          paid_at?: string | null
          pos_session_id?: string | null
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          shift_id?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_discount_approved_by_fkey"
            columns: ["discount_approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_pos_session_id_fkey"
            columns: ["pos_session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      override_approvals: {
        Row: {
          approved_by_staff_id: string
          branch_id: string
          created_at: string
          device_id: string | null
          expires_at: string
          id: string
          permission: string
          requested_by_staff_id: string | null
          used_at: string | null
        }
        Insert: {
          approved_by_staff_id: string
          branch_id: string
          created_at?: string
          device_id?: string | null
          expires_at: string
          id?: string
          permission: string
          requested_by_staff_id?: string | null
          used_at?: string | null
        }
        Update: {
          approved_by_staff_id?: string
          branch_id?: string
          created_at?: string
          device_id?: string | null
          expires_at?: string
          id?: string
          permission?: string
          requested_by_staff_id?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "override_approvals_approved_by_staff_id_fkey"
            columns: ["approved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "override_approvals_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "override_approvals_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "override_approvals_requested_by_staff_id_fkey"
            columns: ["requested_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          name: string
          requires_reference: boolean
          sort_order: number
          type: Database["public"]["Enums"]["payment_method_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          name: string
          requires_reference?: boolean
          sort_order?: number
          type: Database["public"]["Enums"]["payment_method_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          name?: string
          requires_reference?: boolean
          sort_order?: number
          type?: Database["public"]["Enums"]["payment_method_type"]
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          branch_id: string
          change_given: number | null
          client_created_at: string | null
          created_at: string
          device_id: string | null
          id: string
          is_offline: boolean
          method: Database["public"]["Enums"]["payment_method_type"]
          method_name: string
          order_id: string
          payment_method_id: string
          pos_session_id: string | null
          reference: string | null
          shift_id: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          tendered: number | null
        }
        Insert: {
          amount: number
          branch_id: string
          change_given?: number | null
          client_created_at?: string | null
          created_at?: string
          device_id?: string | null
          id: string
          is_offline?: boolean
          method: Database["public"]["Enums"]["payment_method_type"]
          method_name: string
          order_id: string
          payment_method_id: string
          pos_session_id?: string | null
          reference?: string | null
          shift_id?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tendered?: number | null
        }
        Update: {
          amount?: number
          branch_id?: string
          change_given?: number | null
          client_created_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          is_offline?: boolean
          method?: Database["public"]["Enums"]["payment_method_type"]
          method_name?: string
          order_id?: string
          payment_method_id?: string
          pos_session_id?: string | null
          reference?: string | null
          shift_id?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tendered?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_pos_session_id_fkey"
            columns: ["pos_session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_attempts: {
        Row: {
          attempted_at: string
          device_id: string
          id: number
          success: boolean
        }
        Insert: {
          attempted_at?: string
          device_id: string
          id?: never
          success: boolean
        }
        Update: {
          attempted_at?: string
          device_id?: string
          id?: never
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "pin_attempts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sessions: {
        Row: {
          branch_id: string
          device_id: string
          ended_at: string | null
          id: string
          is_offline: boolean
          staff_id: string
          started_at: string
        }
        Insert: {
          branch_id: string
          device_id: string
          ended_at?: string | null
          id?: string
          is_offline?: boolean
          staff_id: string
          started_at?: string
        }
        Update: {
          branch_id?: string
          device_id?: string
          ended_at?: string | null
          id?: string
          is_offline?: boolean
          staff_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sessions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          approved_by: string | null
          branch_id: string
          client_created_at: string | null
          created_at: string
          device_id: string | null
          id: string
          line_ids: string[]
          method: Database["public"]["Enums"]["payment_method_type"]
          method_name: string
          order_id: string
          payment_method_id: string | null
          pos_session_id: string | null
          reason: string
          reference: string | null
          shift_id: string
          staff_id: string
        }
        Insert: {
          amount: number
          approved_by?: string | null
          branch_id: string
          client_created_at?: string | null
          created_at?: string
          device_id?: string | null
          id: string
          line_ids?: string[]
          method: Database["public"]["Enums"]["payment_method_type"]
          method_name: string
          order_id: string
          payment_method_id?: string | null
          pos_session_id?: string | null
          reason: string
          reference?: string | null
          shift_id: string
          staff_id: string
        }
        Update: {
          amount?: number
          approved_by?: string | null
          branch_id?: string
          client_created_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          line_ids?: string[]
          method?: Database["public"]["Enums"]["payment_method_type"]
          method_name?: string
          order_id?: string
          payment_method_id?: string | null
          pos_session_id?: string | null
          reason?: string
          reference?: string | null
          shift_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_pos_session_id_fkey"
            columns: ["pos_session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Insert: {
          permission: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Update: {
          permission?: string
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Relationships: []
      }
      settings: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          branch_id: string
          business_day_id: string
          closed_at: string | null
          closed_by: string | null
          counted_cash: number | null
          counted_denominations: Json | null
          device_id: string
          expected_cash: number | null
          id: string
          opened_at: string
          opening_denominations: Json | null
          opening_float: number
          pos_session_id: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string
          status: Database["public"]["Enums"]["shift_status"]
          variance: number | null
        }
        Insert: {
          branch_id: string
          business_day_id: string
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          counted_denominations?: Json | null
          device_id: string
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opening_denominations?: Json | null
          opening_float: number
          pos_session_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id: string
          status?: Database["public"]["Enums"]["shift_status"]
          variance?: number | null
        }
        Update: {
          branch_id?: string
          business_day_id?: string
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          counted_denominations?: Json | null
          device_id?: string
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opening_denominations?: Json | null
          opening_float?: number
          pos_session_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string
          status?: Database["public"]["Enums"]["shift_status"]
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_business_day_id_fkey"
            columns: ["business_day_id"]
            isOneToOne: false
            referencedRelation: "business_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_pos_session_id_fkey"
            columns: ["pos_session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          auth_user_id: string | null
          branch_id: string | null
          created_at: string
          discount_limit_bps: number
          email: string | null
          full_name: string
          has_pin: boolean | null
          id: string
          is_active: boolean
          phone: string | null
          pin_hash: string | null
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          branch_id?: string | null
          created_at?: string
          discount_limit_bps?: number
          email?: string | null
          full_name: string
          has_pin?: boolean | null
          id?: string
          is_active?: boolean
          phone?: string | null
          pin_hash?: string | null
          role: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          branch_id?: string | null
          created_at?: string
          discount_limit_bps?: number
          email?: string | null
          full_name?: string
          has_pin?: boolean | null
          id?: string
          is_active?: boolean
          phone?: string | null
          pin_hash?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      taxes: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_inclusive: boolean
          name: string
          rate_bps: number
          sort_order: number
          tax_category: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_inclusive?: boolean
          name: string
          rate_bps: number
          sort_order?: number
          tax_category?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_inclusive?: boolean
          name?: string
          rate_bps?: number
          sort_order?: number
          tax_category?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allocate_discount: {
        Args: { p_amounts: number[]; p_discount: number }
        Returns: number[]
      }
      branch_setting: {
        Args: { p_branch_id: string; p_key: string }
        Returns: Json
      }
      business_day_summary: { Args: { p_day_id: string }; Returns: Json }
      can_access_branch: { Args: { p_branch_id: string }; Returns: boolean }
      close_business_day: {
        Args: {
          p_branch_id?: string
          p_override_id?: string
          p_session_id?: string
        }
        Returns: Json
      }
      close_shift: {
        Args: {
          p_counted_denominations: Json
          p_session_id: string
          p_shift_id?: string
        }
        Returns: Json
      }
      consume_override: {
        Args: {
          p_branch_id: string
          p_override_id: string
          p_permission: string
        }
        Returns: string
      }
      count_denominations: { Args: { p_counts: Json }; Returns: number }
      current_branch_id: { Args: never; Returns: string }
      current_device: {
        Args: never
        Returns: {
          auth_user_id: string | null
          branch_id: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          last_seen_at: string | null
          name: string
          pending_sync: number | null
          pending_sync_at: string | null
          station: string | null
          type: Database["public"]["Enums"]["device_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "devices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_device_id: { Args: never; Returns: string }
      current_staff: {
        Args: never
        Returns: {
          auth_user_id: string | null
          branch_id: string | null
          created_at: string
          discount_limit_bps: number
          email: string | null
          full_name: string
          has_pin: boolean | null
          id: string
          is_active: boolean
          phone: string | null
          pin_hash: string | null
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_staff_id: { Args: never; Returns: string }
      current_staff_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      day_control_actor: {
        Args: {
          p_branch_id: string
          p_override_id: string
          p_session_id: string
        }
        Returns: {
          approver_id: string
          branch_id: string
          device_id: string
          staff_id: string
        }[]
      }
      day_report: { Args: { p_day_id: string }; Returns: Json }
      device_heartbeat: { Args: { p_pending?: number }; Returns: undefined }
      discount_amount: {
        Args: { p_amount: number; p_discount: Json }
        Returns: number
      }
      end_pos_session: { Args: { p_session_id: string }; Returns: undefined }
      find_staff_by_pin: {
        Args: { p_branch_id: string; p_pin: string }
        Returns: string
      }
      get_day_report: { Args: { p_day_id: string }; Returns: Json }
      get_menu: { Args: { p_branch_id: string }; Returns: Json }
      get_offline_bundle: { Args: never; Returns: Json }
      get_order: { Args: { p_order_id: string }; Returns: Json }
      has_permission: { Args: { p_permission: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_device: { Args: never; Returns: boolean }
      is_manager: { Args: never; Returns: boolean }
      line_taxes: {
        Args: { p_gross: number; p_tax_category: string }
        Returns: Json
      }
      list_open_shifts: { Args: { p_session_id: string }; Returns: Json }
      load_sample_menu: { Args: never; Returns: undefined }
      open_business_day: {
        Args: {
          p_branch_id?: string
          p_override_id?: string
          p_session_id?: string
        }
        Returns: Json
      }
      open_shift: {
        Args: {
          p_denominations?: Json
          p_opened_at?: string
          p_opening_float: number
          p_session_id: string
        }
        Returns: Json
      }
      order_audit_trail: {
        Args: { p_order_id: string; p_session_id?: string }
        Returns: Json
      }
      order_line_combo: {
        Args: { p_branch_id: string; p_combo_id: string; p_selections: Json }
        Returns: Json
      }
      order_line_modifiers: {
        Args: {
          p_branch_id: string
          p_menu_item_id: string
          p_modifier_ids: Json
        }
        Returns: Json
      }
      order_summary: { Args: { p_order_id: string }; Returns: Json }
      pin_lockout_seconds: { Args: { p_device_id: string }; Returns: number }
      record_cash_movement: {
        Args: { p_movement: Json; p_session_id: string }
        Returns: Json
      }
      record_offline_override: {
        Args: {
          p_approved_at?: string
          p_approver_staff_id: string
          p_override_id: string
          p_permission: string
          p_reason?: string
          p_session_id: string
        }
        Returns: Json
      }
      record_payments: {
        Args: { p_order_id: string; p_payments: Json; p_session_id: string }
        Returns: Json
      }
      refund_order: {
        Args: { p_refund: Json; p_session_id: string }
        Returns: Json
      }
      reorder_menu: {
        Args: { p_ids: string[]; p_kind: string; p_parent_id?: string }
        Returns: undefined
      }
      report_exceptions: {
        Args: { p_branch_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      require_open_shift: {
        Args: { p_device_id: string; p_staff_id: string }
        Returns: {
          branch_id: string
          business_day_id: string
          closed_at: string | null
          closed_by: string | null
          counted_cash: number | null
          counted_denominations: Json | null
          device_id: string
          expected_cash: number | null
          id: string
          opened_at: string
          opening_denominations: Json | null
          opening_float: number
          pos_session_id: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string
          status: Database["public"]["Enums"]["shift_status"]
          variance: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      require_pos_session: {
        Args: { p_session_id: string }
        Returns: {
          branch_id: string
          device_id: string
          ended_at: string | null
          id: string
          is_offline: boolean
          staff_id: string
          started_at: string
        }
        SetofOptions: {
          from: "*"
          to: "pos_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_shift: {
        Args: { p_note?: string; p_shift_id: string; p_status: string }
        Returns: Json
      }
      round_div: {
        Args: { p_denominator: number; p_numerator: number }
        Returns: number
      }
      sales_summary: {
        Args: { p_day_id: string; p_shift_id: string }
        Returns: Json
      }
      search_orders: {
        Args: {
          p_amount?: number
          p_branch_id: string
          p_business_date?: string
          p_number?: string
          p_reference?: string
        }
        Returns: Json
      }
      send_order_lines_to_kitchen: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      send_to_kitchen: {
        Args: { p_order_id: string; p_session_id: string }
        Returns: Json
      }
      set_availability: {
        Args: {
          p_available: boolean
          p_branch_id: string
          p_kind: string
          p_target_id: string
        }
        Returns: undefined
      }
      set_branch_price: {
        Args: { p_branch_id: string; p_menu_item_id: string; p_price: number }
        Returns: undefined
      }
      set_staff_login: {
        Args: { p_auth_user_id: string; p_staff_id: string }
        Returns: undefined
      }
      set_staff_pin: {
        Args: { p_pin: string; p_staff_id: string }
        Returns: undefined
      }
      shift_cash: { Args: { p_shift_id: string }; Returns: Json }
      shift_expected_cash: { Args: { p_shift_id: string }; Returns: number }
      shift_manager_view: { Args: { p_shift_id: string }; Returns: Json }
      shift_report: {
        Args: { p_for_manager: boolean; p_shift_id: string }
        Returns: Json
      }
      shift_summary: { Args: { p_shift_id: string }; Returns: Json }
      staff_has_permission: {
        Args: { p_permission: string; p_staff_id: string }
        Returns: boolean
      }
      staff_permissions: { Args: { p_staff_id: string }; Returns: string[] }
      start_offline_session: {
        Args: { p_session_id: string; p_staff_id: string; p_started_at: string }
        Returns: Json
      }
      start_pos_session: { Args: { p_pin: string }; Returns: Json }
      submit_order: {
        Args: { p_order: Json; p_session_id: string }
        Returns: Json
      }
      till_state: { Args: { p_session_id: string }; Returns: Json }
      verify_override: {
        Args: {
          p_permission: string
          p_pin: string
          p_reason?: string
          p_session_id: string
        }
        Returns: Json
      }
      void_order_items: {
        Args: {
          p_item_ids: string[]
          p_order_id: string
          p_override_id?: string
          p_reason: string
          p_session_id: string
        }
        Returns: Json
      }
      write_audit: {
        Args: {
          p_action: string
          p_actor_staff_id?: string
          p_after?: Json
          p_approver_staff_id?: string
          p_before?: Json
          p_branch_id?: string
          p_device_id?: string
          p_entity: string
          p_entity_id: string
          p_is_offline?: boolean
          p_reason?: string
        }
        Returns: number
      }
      x_report: { Args: { p_session_id: string }; Returns: Json }
    }
    Enums: {
      business_day_status: "open" | "closed"
      cash_movement_type: "drop" | "paid_in" | "paid_out" | "no_sale"
      device_type: "till" | "kds" | "pickup" | "kiosk"
      menu_item_type: "item" | "combo"
      order_channel: "counter" | "kiosk" | "online" | "drive_thru"
      order_item_status: "pending" | "sent" | "ready" | "voided"
      order_status:
        | "open"
        | "paid"
        | "in_kitchen"
        | "ready"
        | "collected"
        | "voided"
        | "refunded"
        | "partially_refunded"
      order_type: "dine_in" | "takeaway" | "delivery"
      payment_method_type: "cash" | "card" | "mobile_money" | "other"
      payment_status: "captured" | "refunded"
      shift_status: "open" | "pending_review" | "approved" | "flagged"
      staff_role: "admin" | "manager" | "cashier"
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
      business_day_status: ["open", "closed"],
      cash_movement_type: ["drop", "paid_in", "paid_out", "no_sale"],
      device_type: ["till", "kds", "pickup", "kiosk"],
      menu_item_type: ["item", "combo"],
      order_channel: ["counter", "kiosk", "online", "drive_thru"],
      order_item_status: ["pending", "sent", "ready", "voided"],
      order_status: [
        "open",
        "paid",
        "in_kitchen",
        "ready",
        "collected",
        "voided",
        "refunded",
        "partially_refunded",
      ],
      order_type: ["dine_in", "takeaway", "delivery"],
      payment_method_type: ["cash", "card", "mobile_money", "other"],
      payment_status: ["captured", "refunded"],
      shift_status: ["open", "pending_review", "approved", "flagged"],
      staff_role: ["admin", "manager", "cashier"],
    },
  },
} as const

