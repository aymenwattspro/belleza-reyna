'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Orders repository — Supabase data access (shared workspace)
//
//  Maps the DB's snake_case rows to the app's camelCase order shapes so the rest
//  of the app (OrderContext + pages) keeps its existing types. Confirmation goes
//  through the atomic RPCs (confirm_order_lines / confirm_draft_order); everything
//  else is direct table CRUD (RLS = approved users share everything).
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient } from '../client';
import type {
  ConfirmedOrder,
  OrderItem,
  DraftOrder,
  DraftOrderItem,
  ExcludedProduct,
} from '@/lib/db/orders-db';

// ── Row shapes (snake_case) ───────────────────────────────────────────────────
interface DraftOrderRow {
  id: string;
  name: string;
  supplier_name: string;
  total_products: number;
  total_value: number;
  created_at: string;
  updated_at: string;
}
interface DraftItemRow {
  draft_id: string;
  clave: string;
  descripcion: string;
  proveedor: string;
  current_stock: number;
  units_to_order: number;
  unit_cost: number;
  line_total: number;
}
interface ConfirmedOrderRow {
  id: string;
  supplier_name: string;
  total_products: number;
  total_value: number;
  confirmed_at: string;
}
interface OrderItemRow {
  order_id: string;
  clave: string;
  descripcion: string;
  proveedor: string;
  current_stock: number;
  units_to_order: number;
  unit_cost: number;
  line_total: number;
}
interface ExcludedRow {
  clave: string;
  descripcion: string;
  proveedor: string;
  excluded_at: string;
}

// ── Mappers ───────────────────────────────────────────────────────────────────
const toDraftItem = (r: DraftItemRow): DraftOrderItem => ({
  clave: r.clave,
  descripcion: r.descripcion,
  proveedor: r.proveedor,
  currentStock: Number(r.current_stock),
  unitsToOrder: Number(r.units_to_order),
  unitCost: Number(r.unit_cost),
  lineTotal: Number(r.line_total),
});

const toOrderItem = (r: OrderItemRow): OrderItem => ({
  orderId: r.order_id,
  clave: r.clave,
  descripcion: r.descripcion,
  proveedor: r.proveedor,
  currentStock: Number(r.current_stock),
  unitsToOrder: Number(r.units_to_order),
  unitCost: Number(r.unit_cost),
  lineTotal: Number(r.line_total),
});

const draftItemRow = (draftId: string, i: DraftOrderItem) => ({
  draft_id: draftId,
  clave: i.clave,
  descripcion: i.descripcion,
  proveedor: i.proveedor || 'General',
  current_stock: i.currentStock,
  units_to_order: i.unitsToOrder,
  unit_cost: i.unitCost,
  line_total: i.lineTotal,
});

/** De-duplicate items by clave (keeps the last occurrence). */
function dedupeItems(items: DraftOrderItem[]): DraftOrderItem[] {
  const map = new Map<string, DraftOrderItem>();
  for (const i of items) map.set(i.clave, i);
  return Array.from(map.values());
}

export const ordersRepo = {
  isAvailable(): boolean {
    return getSupabaseClient() != null;
  },

  // ── Deselected products ─────────────────────────────────────────────────────
  async getDeselectedClaves(): Promise<string[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const { data, error } = await supabase.from('deselected_products').select('clave');
    if (error) throw error;
    return (data as { clave: string }[]).map((r) => r.clave);
  },

  async deselect(clave: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase
      .from('deselected_products')
      .upsert({ clave }, { onConflict: 'clave', ignoreDuplicates: true });
    if (error) throw error;
  },

  async reselect(clave: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.from('deselected_products').delete().eq('clave', clave);
    if (error) throw error;
  },

  /** Batch select/deselect: select=true removes deselect flag, false adds it. */
  async setDeselected(claves: string[], select: boolean): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase || claves.length === 0) return;
    if (select) {
      const { error } = await supabase.from('deselected_products').delete().in('clave', claves);
      if (error) throw error;
    } else {
      const rows = claves.map((clave) => ({ clave }));
      const { error } = await supabase
        .from('deselected_products')
        .upsert(rows, { onConflict: 'clave', ignoreDuplicates: true });
      if (error) throw error;
    }
  },

  // ── Excluded products ("Do Not Order") ──────────────────────────────────────
  async getExcludedProducts(): Promise<ExcludedProduct[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('excluded_products')
      .select('clave, descripcion, proveedor, excluded_at')
      .order('excluded_at', { ascending: false });
    if (error) throw error;
    return (data as ExcludedRow[]).map((r) => ({
      clave: r.clave,
      descripcion: r.descripcion,
      proveedor: r.proveedor,
      excludedAt: r.excluded_at,
    }));
  },

  async excludeProduct(p: ExcludedProduct): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.from('excluded_products').upsert(
      {
        clave: p.clave,
        descripcion: p.descripcion,
        proveedor: p.proveedor || 'General',
        excluded_at: p.excludedAt,
      },
      { onConflict: 'clave' }
    );
    if (error) throw error;
  },

  async includeProduct(clave: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.from('excluded_products').delete().eq('clave', clave);
    if (error) throw error;
  },

  // ── Confirmed-order claves (current cycle) ──────────────────────────────────
  async getConfirmedClaves(): Promise<string[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const { data, error } = await supabase.from('confirmed_order_claves').select('clave');
    if (error) throw error;
    return (data as { clave: string }[]).map((r) => r.clave);
  },

  // ── Draft / pending orders ──────────────────────────────────────────────────
  async getDraftOrders(): Promise<DraftOrder[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const { data: drafts, error } = await supabase
      .from('draft_orders')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const rows = (drafts ?? []) as DraftOrderRow[];
    if (rows.length === 0) return [];

    const ids = rows.map((d) => d.id);
    const { data: items, error: iErr } = await supabase
      .from('draft_order_items')
      .select('*')
      .in('draft_id', ids);
    if (iErr) throw iErr;

    const byDraft = new Map<string, DraftOrderItem[]>();
    for (const it of (items ?? []) as DraftItemRow[]) {
      const list = byDraft.get(it.draft_id) ?? [];
      list.push(toDraftItem(it));
      byDraft.set(it.draft_id, list);
    }
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      supplierName: d.supplier_name,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      totalProducts: d.total_products,
      totalValue: Number(d.total_value),
      items: byDraft.get(d.id) ?? [],
    }));
  },

  async getDraftOrder(id: string): Promise<DraftOrder | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const { data: d, error } = await supabase
      .from('draft_orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!d) return null;
    const row = d as DraftOrderRow;
    const { data: items, error: iErr } = await supabase
      .from('draft_order_items')
      .select('*')
      .eq('draft_id', id);
    if (iErr) throw iErr;
    return {
      id: row.id,
      name: row.name,
      supplierName: row.supplier_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      totalProducts: row.total_products,
      totalValue: Number(row.total_value),
      items: ((items ?? []) as DraftItemRow[]).map(toDraftItem),
    };
  },

  /** Create a NEW draft (DB generates the uuid). Returns the assembled draft. */
  async createDraft(input: {
    name: string;
    supplierName: string;
    items: DraftOrderItem[];
    createdAt?: string;
    updatedAt?: string;
  }): Promise<DraftOrder> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase not configured');

    const items = dedupeItems(input.items);
    const totalProducts = items.length;
    const totalValue = items.reduce((s, i) => s + i.lineTotal, 0);

    const insertRow = {
      name: input.name,
      supplier_name: input.supplierName || 'General',
      total_products: totalProducts,
      total_value: totalValue,
      ...(input.createdAt ? { created_at: input.createdAt } : {}),
      ...(input.updatedAt ? { updated_at: input.updatedAt } : {}),
    };

    const { data, error } = await supabase
      .from('draft_orders')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) throw error;
    const row = data as DraftOrderRow;

    if (items.length > 0) {
      const { error: iErr } = await supabase
        .from('draft_order_items')
        .insert(items.map((i) => draftItemRow(row.id, i)));
      if (iErr) throw iErr;
    }

    return {
      id: row.id,
      name: row.name,
      supplierName: row.supplier_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      totalProducts,
      totalValue,
      items,
    };
  },

  /** Replace an existing draft's fields + items (by id). */
  async updateDraft(draft: DraftOrder): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const items = dedupeItems(draft.items);
    const totalProducts = items.length;
    const totalValue = items.reduce((s, i) => s + i.lineTotal, 0);

    const { error } = await supabase
      .from('draft_orders')
      .update({
        name: draft.name,
        supplier_name: draft.supplierName || 'General',
        total_products: totalProducts,
        total_value: totalValue,
      })
      .eq('id', draft.id);
    if (error) throw error;

    // Replace items: delete all, then insert the new set.
    const { error: dErr } = await supabase
      .from('draft_order_items')
      .delete()
      .eq('draft_id', draft.id);
    if (dErr) throw dErr;

    if (items.length > 0) {
      const { error: iErr } = await supabase
        .from('draft_order_items')
        .insert(items.map((i) => draftItemRow(draft.id, i)));
      if (iErr) throw iErr;
    }
  },

  async deleteDraftOrder(id: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.from('draft_orders').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Confirmed orders (history) ──────────────────────────────────────────────
  async getConfirmedOrders(): Promise<ConfirmedOrder[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const { data: orders, error } = await supabase
      .from('confirmed_orders')
      .select('*')
      .order('confirmed_at', { ascending: false });
    if (error) throw error;
    const rows = (orders ?? []) as ConfirmedOrderRow[];
    if (rows.length === 0) return [];

    const ids = rows.map((o) => o.id);
    const { data: items, error: iErr } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', ids);
    if (iErr) throw iErr;

    const byOrder = new Map<string, OrderItem[]>();
    for (const it of (items ?? []) as OrderItemRow[]) {
      const list = byOrder.get(it.order_id) ?? [];
      list.push(toOrderItem(it));
      byOrder.set(it.order_id, list);
    }
    return rows.map((o) => ({
      id: o.id,
      confirmedAt: o.confirmed_at,
      supplierName: o.supplier_name,
      totalProducts: o.total_products,
      totalValue: Number(o.total_value),
      items: byOrder.get(o.id) ?? [],
    }));
  },

  async deleteConfirmedOrder(id: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.from('confirmed_orders').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Atomic confirmation (RPCs) ──────────────────────────────────────────────
  /** Confirm selected order lines → new confirmed order id. */
  async confirmOrderLines(supplier: string, items: OrderItem[]): Promise<string> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase not configured');
    const payload = items.map((i) => ({
      clave: i.clave,
      descripcion: i.descripcion,
      proveedor: i.proveedor || 'General',
      current_stock: i.currentStock,
      units_to_order: i.unitsToOrder,
      unit_cost: i.unitCost,
      line_total: i.lineTotal,
    }));
    const { data, error } = await supabase.rpc('confirm_order_lines', {
      p_supplier: supplier || 'Mixed',
      p_items: payload,
    });
    if (error) throw error;
    console.log('CONFIRM ORDER LINES RPC CALLED', {
      supplier,
      itemsCount: items.length,
    });
    return data as string;
  },

  /** Promote a draft to a confirmed order (atomic) → new confirmed order id. */
  async confirmDraft(draftId: string): Promise<string> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('confirm_draft_order', { p_draft_id: draftId });
    if (error) throw error;
    console.log('CONFIRM DRAFT RPC CALLED', {
      draftId,
    });
    return data as string;
    console.log('CONFIRM DRAFT RPC CALLED');
  },

  // ── Migration helpers (one-time IndexedDB → Supabase) ───────────────────────
  async insertExcluded(list: ExcludedProduct[]): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase || list.length === 0) return;
    const rows = list.map((p) => ({
      clave: p.clave,
      descripcion: p.descripcion,
      proveedor: p.proveedor || 'General',
      excluded_at: p.excludedAt,
    }));
    const { error } = await supabase
      .from('excluded_products')
      .upsert(rows, { onConflict: 'clave', ignoreDuplicates: true });
    if (error) throw error;
  },

  async insertDeselected(claves: string[]): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase || claves.length === 0) return;
    const rows = claves.map((clave) => ({ clave }));
    const { error } = await supabase
      .from('deselected_products')
      .upsert(rows, { onConflict: 'clave', ignoreDuplicates: true });
    if (error) throw error;
  },

  async insertConfirmedClaves(claves: string[]): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase || claves.length === 0) return;
    const rows = claves.map((clave) => ({ clave }));
    const { error } = await supabase
      .from('confirmed_order_claves')
      .upsert(rows, { onConflict: 'clave', ignoreDuplicates: true });
    if (error) throw error;
  },

  /** Direct insert of a historical confirmed order, preserving confirmedAt. */
  async insertConfirmedOrder(order: ConfirmedOrder): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data, error } = await supabase
      .from('confirmed_orders')
      .insert({
        supplier_name: order.supplierName || 'General',
        total_products: order.totalProducts,
        total_value: order.totalValue,
        confirmed_at: order.confirmedAt,
      })
      .select('id')
      .single();
    if (error) throw error;
    const orderId = (data as { id: string }).id;
    if (order.items.length > 0) {
      const rows = order.items.map((i) => ({
        order_id: orderId,
        clave: i.clave,
        descripcion: i.descripcion,
        proveedor: i.proveedor || 'General',
        current_stock: i.currentStock,
        units_to_order: i.unitsToOrder,
        unit_cost: i.unitCost,
        line_total: i.lineTotal,
      }));
      const { error: iErr } = await supabase.from('order_items').insert(rows);
      if (iErr) throw iErr;
    }
  },
};
