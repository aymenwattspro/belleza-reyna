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
      };
      product_settings: {
        Row: {
          id: string;
          clave: string;
          stock_objetivo: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Omit<Database['public']['Tables']['product_settings']['Row'], 'id' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['product_settings']['Insert']>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
