// ── Auto-generated Supabase type stubs ───────────────────────────────────────
// For full type-safety, run: npx supabase gen types typescript --linked > src/lib/supabase/types.ts
// For now this provides a plain stub so the client compiles without errors.

export type Database = {
  public: {
    Tables: {
      inventory_snapshots: {
        Row: {
          id: string;
          date: string;
          supplier_name: string;
          source_file_name: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: Omit<Database['public']['Tables']['inventory_snapshots']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['inventory_snapshots']['Insert']>;
        Relationships: [];
      };

      inventory_products: {
        Row: {
          id: string;
          snapshot_id: string;
          clave: string;
          descripcion: string;
          proveedor: string | null;
          existencia: number;
          precio_c: number | null;
          precio_v: number | null;
          stock_objetivo: number | null;
        };
        Insert: Omit<Database['public']['Tables']['inventory_products']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['inventory_products']['Insert']>;
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
        Insert: Omit<Database['public']['Tables']['confirmed_orders']['Row'], 'id'>;
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
        Insert: Omit<Database['public']['Tables']['order_items']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['order_items']['Insert']>;
        Relationships: [];
      };
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

      profiles: {
        Row: {
          id: string;
          email: string | null;
          is_approved: boolean;
          role: string;
          created_at: string;
        };
        Insert: { id?: string } & Omit<Database['public']['Tables']['profiles']['Row'], 'id' | 'created_at'>;
        Update: Partial<{ id?: string } & Omit<Database['public']['Tables']['profiles']['Row'], 'created_at'>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_user_approval: {
        Args: {
          user_id: string;
        };
        Returns: boolean;
      };
    };
  };
};
