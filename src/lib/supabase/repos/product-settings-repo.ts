'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Product settings repository — Supabase data access (shared workspace)
//  Maps the DB's snake_case `product_settings` rows to the app's camelCase
//  `ProductSettings` shape so ProductSettingsContext is unchanged for callers.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient } from '../client';
import type { ProductSettings } from '@/lib/db/product-settings-db';

export type { ProductSettings } from '@/lib/db/product-settings-db';

interface SettingsRow {
  clave: string;
  min_stock_units: number;
  min_stock_cases: number;
  units_per_case_override: number | null;
  notes: string | null;
  updated_at: string;
}

function toSettings(r: SettingsRow): ProductSettings {
  return {
    clave: r.clave,
    minStockUnits: Number(r.min_stock_units) || 0,
    minStockCases: Number(r.min_stock_cases) || 0,
    unitsPerCaseOverride: r.units_per_case_override ?? undefined,
    notes: r.notes ?? undefined,
    updatedAt: r.updated_at,
  };
}

export const productSettingsRepo = {
  isAvailable(): boolean {
    return getSupabaseClient() != null;
  },

  async getAll(): Promise<ProductSettings[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const { data, error } = await supabase.from('product_settings').select('*');
    if (error) throw error;
    return (data as SettingsRow[]).map(toSettings);
  },

  /** Upsert settings for a product (keyed by clave). */
  async save(settings: ProductSettings): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('product_settings').upsert(
      {
        clave: settings.clave,
        min_stock_units: settings.minStockUnits ?? 0,
        min_stock_cases: settings.minStockCases ?? 0,
        units_per_case_override: settings.unitsPerCaseOverride ?? null,
        notes: settings.notes ?? null,
      },
      { onConflict: 'clave' }
    );
    if (error) throw error;
  },

  async remove(clave: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('product_settings').delete().eq('clave', clave);
    if (error) throw error;
  },
};
