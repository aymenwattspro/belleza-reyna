// ─────────────────────────────────────────────────────────────────────────────
//  Supabase Database types — generated to match the FINAL shared-workspace schema
//  (supabase/migrations/001_shared_workspace_schema.sql + 002 + 003).
//
//  To refresh authoritatively from your live project, run:
//    npm run gen:types
//  (which calls: supabase gen types typescript --linked > src/lib/supabase/types.ts)
//  This hand-maintained version mirrors that output so the app is fully typed even
//  before the CLI is linked.
// ─────────────────────────────────────────────────────────────────────────────

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      suppliers: {
        Row: {
          id: string;
          name: string;
          contact_person: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          contact_person?: string | null;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['suppliers']['Insert']>;
        Relationships: [];
      };

      imports: {
        Row: {
          id: string;
          file_name: string;
          supplier_name: string | null;
          file_hash: string | null;
          product_count: number;
          import_type: string;
          imported_at: string;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          file_name?: string;
          supplier_name?: string | null;
          file_hash?: string | null;
          product_count?: number;
          import_type?: string;
          imported_at?: string;
          created_at?: string;
          created_by?: string | null;
        };

        Update: Partial<Database['public']['Tables']['imports']['Insert']>;
        Relationships: [];
      };

      current_inventory: {
        Row: {
          clave: string;
          descripcion: string;
          proveedor: string;
          existencia: number;
          precio_c: number;
          precio_v: number | null;
          stock_objetivo: number | null;
          piezas: number | null;
          first_seen_date: string;
          last_updated_date: string;
          history_count: number;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          clave: string;
          descripcion?: string;
          proveedor?: string;
          existencia?: number;
          precio_c?: number;
          precio_v?: number | null;
          stock_objetivo?: number | null;
          piezas?: number | null;
          first_seen_date?: string;
          last_updated_date?: string;
          history_count?: number;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: Partial<Database['public']['Tables']['current_inventory']['Insert']>;
        Relationships: [];
      };

      stock_history: {
        Row: {
          id: number;
          clave: string;
          descripcion: string;
          proveedor: string;
          existencia: number;
          precio_c: number;
          precio_v: number | null;
          stock_objetivo: number | null;
          piezas: number | null;
          import_id: string | null;
          import_date: string;
          import_timestamp: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          clave: string;
          descripcion?: string;
          proveedor?: string;
          existencia?: number;
          precio_c?: number;
          precio_v?: number | null;
          stock_objetivo?: number | null;
          piezas?: number | null;
          import_id?: string | null;
          import_date?: string;
          import_timestamp?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['stock_history']['Insert']>;
        Relationships: [];
      };

      product_settings: {
        Row: {
          clave: string;
          min_stock_units: number;
          min_stock_cases: number;
          units_per_case_override: number | null;
          notes: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          clave: string;
          min_stock_units?: number;
          min_stock_cases?: number;
          units_per_case_override?: number | null;
          notes?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['product_settings']['Insert']>;
        Relationships: [];
      };

      draft_orders: {
        Row: {
          id: string;
          name: string;
          supplier_name: string;
          total_products: number;
          total_value: number;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          id?: string;
          name: string;
          supplier_name?: string;
          total_products?: number;
          total_value?: number;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          updated_by?: string | null;
          version?: number;
        };
        Update: Partial<Database['public']['Tables']['draft_orders']['Insert']>;
        Relationships: [];
      };

      draft_order_items: {
        Row: {
          id: string;
          draft_id: string;
          clave: string;
          descripcion: string;
          proveedor: string;
          current_stock: number;
          units_to_order: number;
          unit_cost: number;
          line_total: number;
        };
        Insert: {
          id?: string;
          draft_id: string;
          clave: string;
          descripcion?: string;
          proveedor?: string;
          current_stock?: number;
          units_to_order?: number;
          unit_cost?: number;
          line_total?: number;
        };
        Update: Partial<Database['public']['Tables']['draft_order_items']['Insert']>;
        Relationships: [];
      };

      confirmed_orders: {
        Row: {
          id: string;
          supplier_name: string;
          total_products: number;
          total_value: number;
          confirmed_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          supplier_name?: string;
          total_products?: number;
          total_value?: number;
          confirmed_at?: string;
          created_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['confirmed_orders']['Insert']>;
        Relationships: [];
      };

      order_items: {
        Row: {
          id: string;
          order_id: string;
          clave: string;
          descripcion: string;
          proveedor: string;
          current_stock: number;
          units_to_order: number;
          unit_cost: number;
          line_total: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          clave: string;
          descripcion?: string;
          proveedor?: string;
          current_stock?: number;
          units_to_order?: number;
          unit_cost?: number;
          line_total?: number;
        };
        Update: Partial<Database['public']['Tables']['order_items']['Insert']>;
        Relationships: [];
      };

      excluded_products: {
        Row: {
          clave: string;
          descripcion: string;
          proveedor: string;
          excluded_at: string;
          excluded_by: string | null;
        };
        Insert: {
          clave: string;
          descripcion?: string;
          proveedor?: string;
          excluded_at?: string;
          excluded_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['excluded_products']['Insert']>;
        Relationships: [];
      };

      deselected_products: {
        Row: {
          clave: string;
          deselected_at: string;
          deselected_by: string | null;
        };
        Insert: {
          clave: string;
          deselected_at?: string;
          deselected_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['deselected_products']['Insert']>;
        Relationships: [];
      };

      confirmed_order_claves: {
        Row: {
          clave: string;
          import_id: string | null;
          confirmed_at: string;
          confirmed_by: string | null;
        };
        Insert: {
          clave: string;
          import_id?: string | null;
          confirmed_at?: string;
          confirmed_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['confirmed_order_claves']['Insert']>;
        Relationships: [];
      };

      app_settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          key: string;
          value?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['app_settings']['Insert']>;
        Relationships: [];
      };

      audit_log: {
        Row: {
          id: number;
          action: string;
          entity_type: string;
          entity_id: string | null;
          actor_id: string | null;
          actor_email: string | null;
          metadata: Json;
          created_at: string;
          // ── Audit metadata (migration 007 — all nullable) ──
          session_id: string | null;
          request_id: string | null;
          source: string | null;
          user_agent: string | null;
          ip_address: string | null;
          geo: Json | null;
          device: Json | null;
        };
        Insert: {
          id?: number;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          actor_id?: string | null;
          actor_email?: string | null;
          metadata?: Json;
          created_at?: string;
          session_id?: string | null;
          request_id?: string | null;
          source?: string | null;
          user_agent?: string | null;
          ip_address?: string | null;
          geo?: Json | null;
          device?: Json | null;
        };
        Update: Partial<Database['public']['Tables']['audit_log']['Insert']>;
        Relationships: [];
      };

      profiles: {
        Row: {
          id: string;
          email: string | null;
          is_approved: boolean;
          role: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          email?: string | null;
          is_approved?: boolean;
          role?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_approved: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      get_user_approval: {
        Args: { user_id: string };
        Returns: boolean;
      };
      get_actor_profile: {
        Args: { p_actor_id: string };
        Returns: {
          id: string;
          email: string | null;
          role: string;
          created_at: string;
        }[];
      };
      log_audit: {
        Args: {
          p_action: string;
          p_entity_type: string;
          p_entity_id?: string;
          p_metadata?: Json;
          p_context?: Json;
        };
        Returns: undefined;
      };
      import_inventory_snapshot: {
        Args: { p_import: Json; p_products: Json };
        Returns: Json;
      };
      delete_import: {
        Args: { p_import_id: string };
        Returns: undefined;
      };
      update_target_stock: {
        Args: { p_updates: Json };
        Returns: number;
      };
      confirm_order_lines: {
        Args: { p_supplier: string; p_items: Json };
        Returns: string;
      };
      confirm_draft_order: {
        Args: { p_draft_id: string };
        Returns: string;
      };
      merge_inventory_product: {
        Args: { p_import_id: string; p_now: string; p_ts: number; r: Json };
        Returns: string;
      };
      begin_import: {
        Args: { p_import: Json };
        Returns: string;
      };
      import_inventory_chunk: {
        Args: { p_import_id: string; p_products: Json };
        Returns: Json;
      };
      finalize_import: {
        Args: { p_import_id: string };
        Returns: Json;
      };
      record_target_import: {
        Args: { p_import: Json };
        Returns: string;
      };
    };

    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
