'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Inventory repository — Supabase data access (shared workspace)
//
//  Supabase is the single source of truth for inventory. Imports run through the
//  chunked RPC flow so large files stay under the PostgREST statement timeout:
//
//      begin_import(meta)  →  import_inventory_chunk(id, batch) × N  →  finalize_import(id)
//
//  Reads map the DB's snake_case rows back to the app's existing camelCase shapes
//  (ImportMeta / CurrentInventoryItem / StockHistoryEntry) so InventoryContext and
//  every consumer keep their current types unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient } from '../client';
import type { Json } from '../types';
import type {
  ImportMeta,
  CurrentInventoryItem,
  StockHistoryEntry,
  SmartSaveResult,
} from '@/lib/db/inventory-db';
import type { InventorySnapshot, ProductSnapshot } from '@/lib/types/inventory-timeline';

// Products per chunk. 500–1000 is the sweet spot recommended by 003_import_chunking.sql.
const CHUNK_SIZE = 500;

// PostgREST returns at most 1000 rows per request by default. Reads that can
// exceed that (current_inventory, stock_history) MUST paginate with .range()
// or they silently truncate — which is exactly what made the home page show
// only 1000 of 1612 products. This is the page size used by those paginated reads.
const PAGE_SIZE = 1000;


// ── Row shapes (snake_case, mirrors src/lib/supabase/types.ts) ────────────────
interface ImportRow {
  id: string;
  file_name: string;
  supplier_name: string | null;
  file_hash: string | null;
  product_count: number;
  imported_at: string;
  import_type?: string | null;
}

interface CurrentInventoryRow {
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
}
interface StockHistoryRow {
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
}

// ── Mappers (snake_case row → app camelCase) ──────────────────────────────────
function toImportMeta(r: ImportRow): ImportMeta {
  return {
    id: r.id,
    timestamp: new Date(r.imported_at).getTime(),
    date: r.imported_at,
    fileName: r.file_name,
    supplierName: r.supplier_name ?? undefined,
    fileHash: r.file_hash ?? undefined,
    productCount: Number(r.product_count) || 0,
    importType: r.import_type === 'targetstock' ? 'targetstock' : 'snapshot',
  };
}


function toCurrentItem(r: CurrentInventoryRow): CurrentInventoryItem {
  return {
    clave: r.clave,
    descripcion: r.descripcion,
    proveedor: r.proveedor || 'General',
    existencia: Number(r.existencia) || 0,
    precioC: Number(r.precio_c) || 0,
    precioV: r.precio_v ?? undefined,
    stockObjetivo: r.stock_objetivo ?? undefined,
    piezas: r.piezas ?? undefined,
    firstSeenDate: r.first_seen_date,
    lastUpdatedDate: r.last_updated_date,
    historyCount: Number(r.history_count) || 0,
  };
}

function toHistoryEntry(r: StockHistoryRow): StockHistoryEntry {
  return {
    id: r.id,
    clave: r.clave,
    descripcion: r.descripcion,
    proveedor: r.proveedor || 'General',
    existencia: Number(r.existencia) || 0,
    precioC: Number(r.precio_c) || 0,
    precioV: r.precio_v ?? undefined,
    stockObjetivo: r.stock_objetivo ?? undefined,
    piezas: r.piezas ?? undefined,
    importDate: r.import_date,
    importTimestamp: Number(r.import_timestamp) || 0,
    importId: r.import_id ?? '',
  };
}

/** Map a ProductSnapshot to the snake_case JSON row the import RPCs expect. */
function toChunkRow(p: ProductSnapshot): Record<string, Json> {
  return {
    clave: String(p.clave ?? '').trim(),
    descripcion: p.descripcion ?? '',
    proveedor: p.proveedor || 'General',
    existencia: Number(p.existencia) || 0,
    precio_c: Number(p.precioC) || 0,
    precio_v: p.precioV ?? null,
    stock_objetivo: p.stockObjetivo ?? null,
    piezas: p.piezas ?? null,
  };
}

export const inventoryRepo = {
  /** True when Supabase is configured (used by the context to pick a data source). */
  isAvailable(): boolean {
    return getSupabaseClient() != null;
  },

  /**
   * Import a parsed inventory snapshot into Supabase using the chunked RPC flow.
   *  1) begin_import(meta)          → import_id
   *  2) import_inventory_chunk(id, batch) for each 500-product batch
   *  3) finalize_import(id)         → close the cycle (clears confirmed claves)
   * Returns the combined { newProducts, updatedProducts, unchangedProducts } counts.
   *
   * Throws Error('DUPLICATE_IMPORT') when the file hash already exists, so callers
   * can show the same "duplicate snapshot" message as the old IndexedDB path.
   */
  async importInventory(snapshot: InventorySnapshot): Promise<SmartSaveResult> {
    console.log('IMPORT INVENTORY REPO ENTERED');
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase not configured');

    // Pre-dedupe by clave across the WHOLE file so a clave never spans two chunks
    // (the server also dedupes per-chunk, but not across chunks).
    const seen = new Set<string>();
    const products = snapshot.products.map(toChunkRow).filter((p) => {
      const clave = p.clave as string;
      if (clave.length < 2) return false;
      if (seen.has(clave)) return false;
      seen.add(clave);
      return true;
    });

    // 1) begin_import
    console.log('BEGIN IMPORT RPC');
    const { data: importId, error: beginErr } = await supabase.rpc('begin_import', {
      p_import: {
        file_name: snapshot.fileName,
        supplier_name: snapshot.supplierName ?? null,
        file_hash: snapshot.fileHash ?? null,
        import_timestamp: snapshot.timestamp,
        import_type: 'snapshot',
      } as Record<string, Json>,
    });

    if (beginErr) {
      const code = (beginErr as { code?: string }).code;
      if (code === '23505' || /DUPLICATE_IMPORT/i.test(beginErr.message ?? '')) {
        throw new Error('DUPLICATE_IMPORT');
      }
      throw beginErr;
    }
    const id = importId as string;

    // 2) import_inventory_chunk × N
    const totals: SmartSaveResult = { newProducts: 0, updatedProducts: 0, unchangedProducts: 0 };
    for (let i = 0; i < products.length; i += CHUNK_SIZE) {
      const chunk = products.slice(i, i + CHUNK_SIZE);
      console.log('IMPORT CHUNK RPC', chunk.length);
      const { data, error } = await supabase.rpc('import_inventory_chunk', {
        p_import_id: id,
        p_products: chunk as Json,
      });
      if (error) throw error;
      const c = (data ?? {}) as { new?: number; updated?: number; unchanged?: number };
      totals.newProducts += c.new ?? 0;
      totals.updatedProducts += c.updated ?? 0;
      totals.unchangedProducts += c.unchanged ?? 0;
    }

    // 3) finalize_import
    console.log('FINALIZE IMPORT RPC');
    const { error: finErr } = await supabase.rpc('finalize_import', { p_import_id: id });
    if (finErr) throw finErr;

    return totals;
  },

  /** All import events, newest first (= ImportMeta[]). */
  async getImports(): Promise<ImportMeta[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    // Try to include import_type. If migration 009 hasn't been applied yet the
    // column won't exist (Postgres 42703) — fall back gracefully so the whole
    // inventory view never breaks just because the type column is missing.
    const withType = await supabase
      .from('imports')
      .select('id, file_name, supplier_name, file_hash, product_count, imported_at, import_type')
      .order('imported_at', { ascending: false });

    if (!withType.error) {
      return (withType.data as ImportRow[]).map(toImportMeta);
    }
    if ((withType.error as { code?: string }).code !== '42703') {
      throw withType.error;
    }

    const { data, error } = await supabase
      .from('imports')
      .select('id, file_name, supplier_name, file_hash, product_count, imported_at')
      .order('imported_at', { ascending: false });
    if (error) throw error;
    return (data as ImportRow[]).map(toImportMeta);
  },

  /**
   * Record a Target-Stock import as a first-class history event (so it shows up
   * in Import History with its real product count + type), WITHOUT touching
   * stock_history / existencia. The actual target values are written separately
   * via updateTargetStock(). Best-effort: if the RPC isn't present yet (migration
   * 009 not applied) the caller simply gets null and the target update still ran.
   */
  async recordTargetImport(meta: {
    fileName: string;
    supplierName?: string;
    fileHash?: string;
    timestamp: number;
    productCount: number;
  }): Promise<string | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const { data, error } = await supabase.rpc('record_target_import', {
      p_import: {
        file_name: meta.fileName,
        supplier_name: meta.supplierName ?? null,
        file_hash: meta.fileHash ?? null,
        import_timestamp: meta.timestamp,
        import_type: 'targetstock',
        product_count: meta.productCount,
      } as Record<string, Json>,
    });
    if (error) {
      // Missing function (migration not applied) → don't break the import flow.
      if ((error as { code?: string }).code === 'PGRST202') return null;
      throw error;
    }
    return (data as string) ?? null;
  },


  /**
   * Canonical current state — one row per unique product.
   * Paginated with .range() so catalogs larger than PostgREST's 1000-row
   * default limit are returned in full (otherwise the list silently truncates).
   */
  async getCurrentInventory(): Promise<CurrentInventoryItem[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const rows: CurrentInventoryRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('current_inventory')
        .select(
          'clave, descripcion, proveedor, existencia, precio_c, precio_v, stock_objetivo, piezas, first_seen_date, last_updated_date, history_count'
        )
        .order('clave', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const batch = (data as CurrentInventoryRow[]) ?? [];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return rows.map(toCurrentItem);
  },


  /** Stock-change history for a single product (oldest → newest). */
  async getProductHistory(clave: string): Promise<StockHistoryEntry[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('stock_history')
      .select(
        'id, clave, descripcion, proveedor, existencia, precio_c, precio_v, stock_objetivo, piezas, import_id, import_date, import_timestamp'
      )
      .eq('clave', clave)
      .order('import_timestamp', { ascending: true });
    if (error) throw error;
    return (data as StockHistoryRow[]).map(toHistoryEntry);
  },

  /**
   * Entire stock-change history (oldest → newest) — used to build virtual snapshots.
   * Paginated with .range() so multi-import histories larger than PostgREST's
   * 1000-row default limit are returned in full. A secondary sort by id keeps
   * pagination deterministic when several rows share an import_timestamp.
   */
  async getAllStockHistory(): Promise<StockHistoryEntry[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const rows: StockHistoryRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('stock_history')
        .select(
          'id, clave, descripcion, proveedor, existencia, precio_c, precio_v, stock_objetivo, piezas, import_id, import_date, import_timestamp'
        )
        .order('import_timestamp', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const batch = (data as StockHistoryRow[]) ?? [];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return rows.map(toHistoryEntry);
  },


  /**
   * Bulk-upsert target stock / piezas (no new import event), via the atomic
   * update_target_stock RPC. Returns the number of products updated.
   */
  async updateTargetStock(
    updates: Map<string, { stockObjetivo: number; piezas: number; descripcion?: string; proveedor?: string }>
  ): Promise<number> {
    const supabase = getSupabaseClient();
    if (!supabase || updates.size === 0) return 0;
    const payload: Record<string, Json>[] = [];
    for (const [clave, u] of updates) {
      payload.push({
        clave,
        stock_objetivo: u.stockObjetivo ?? 0,
        piezas: u.piezas ?? 1,
        descripcion: u.descripcion ?? '',
        proveedor: u.proveedor ?? '',
      });
    }
    const { data, error } = await supabase.rpc('update_target_stock', { p_updates: payload as Json });
    if (error) throw error;
    return (data as number) ?? payload.length;
  },

  /** Delete an import and rebuild current_inventory from remaining history (atomic). */
  async deleteImport(importId: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.rpc('delete_import', { p_import_id: importId });
    if (error) throw error;
  },

  /** Wipe all inventory (imports → cascades stock_history, then current_inventory). */
  async clearAll(): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    // Deleting imports cascade-deletes stock_history (FK on delete cascade).
    const { error: impErr } = await supabase.from('imports').delete().not('id', 'is', null);
    if (impErr) throw impErr;
    // current_inventory is not FK-linked to imports, so clear it explicitly.
    const { error: invErr } = await supabase.from('current_inventory').delete().neq('clave', '');
    if (invErr) throw invErr;
  },

  /** Duplicate-file guard — true when an import already exists for this hash. */
  async isFileDuplicate(fileHash: string): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase || !fileHash) return false;
    const { data, error } = await supabase
      .from('imports')
      .select('id')
      .eq('file_hash', fileHash)
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  },
};
