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
          staff_id: string
          started_at: string
        }
        Insert: {
          branch_id: string
          device_id: string
          ended_at?: string | null
          id?: string
          staff_id: string
          started_at?: string
        }
        Update: {
          branch_id?: string
          device_id?: string
          ended_at?: string | null
          id?: string
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
      can_access_branch: { Args: { p_branch_id: string }; Returns: boolean }
      consume_override: {
        Args: {
          p_branch_id: string
          p_override_id: string
          p_permission: string
        }
        Returns: string
      }
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
      device_heartbeat: { Args: never; Returns: undefined }
      end_pos_session: { Args: { p_session_id: string }; Returns: undefined }
      find_staff_by_pin: {
        Args: { p_branch_id: string; p_pin: string }
        Returns: string
      }
      has_permission: { Args: { p_permission: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_device: { Args: never; Returns: boolean }
      is_manager: { Args: never; Returns: boolean }
      pin_lockout_seconds: { Args: { p_device_id: string }; Returns: number }
      require_pos_session: {
        Args: { p_session_id: string }
        Returns: {
          branch_id: string
          device_id: string
          ended_at: string | null
          id: string
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
      set_staff_login: {
        Args: { p_auth_user_id: string; p_staff_id: string }
        Returns: undefined
      }
      set_staff_pin: {
        Args: { p_pin: string; p_staff_id: string }
        Returns: undefined
      }
      staff_has_permission: {
        Args: { p_permission: string; p_staff_id: string }
        Returns: boolean
      }
      staff_permissions: { Args: { p_staff_id: string }; Returns: string[] }
      start_pos_session: { Args: { p_pin: string }; Returns: Json }
      verify_override: {
        Args: {
          p_permission: string
          p_pin: string
          p_reason?: string
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
    }
    Enums: {
      device_type: "till" | "kds" | "pickup" | "kiosk"
      payment_method_type: "cash" | "card" | "mobile_money" | "other"
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
      device_type: ["till", "kds", "pickup", "kiosk"],
      payment_method_type: ["cash", "card", "mobile_money", "other"],
      staff_role: ["admin", "manager", "cashier"],
    },
  },
} as const

