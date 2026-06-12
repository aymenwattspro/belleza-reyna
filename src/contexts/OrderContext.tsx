'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { ConfirmedOrder, OrderItem, DraftOrder, DraftOrderItem, ExcludedProduct } from '@/lib/db/orders-db';
import { ordersRepo } from '@/lib/supabase/repos/orders-repo';
import { subscribeTable } from '@/lib/supabase/realtime';
import { migrateOrdersToSupabaseOnce } from '@/lib/supabase/orders-migration';
import { useAuth } from '@/contexts/AuthContext';

import { adjustOrder } from '@/lib/utils/adjust-order';
import { ProductSnapshot } from '@/lib/types/inventory-timeline';
import { toast } from 'sonner';


export interface OrderLineItem {
  clave: string;
  descripcion: string;
  proveedor: string;
  currentStock: number;
  stockObjetivo: number;
  piezas: number;
  unitCost: number;
  baseOrder: number;     // Raw need (stockObjetivo - currentStock)
  unitsToOrder: number;  // After adjustOrder formula
  lineTotal: number;
  selected: boolean;
}

interface OrderContextType {
  // Current order items (products that need ordering)
  orderLines: OrderLineItem[];
  deselectedClaves: Set<string>;

  // Permanently excluded products ("Do Not Order") — filtered out of all
  // order calculations until the user re-enables them.
  excludedProducts: ExcludedProduct[];
  excludedClaves: Set<string>;


  // Confirmed order history
  confirmedOrders: ConfirmedOrder[];

  // Draft / pending orders (do NOT affect dashboards until confirmed)
  draftOrders: DraftOrder[];

  // Loading
  loading: boolean;

  // Actions
  buildOrderFromSnapshot: (
    products: ProductSnapshot[],
    settingsMap?: Map<string, { minStockUnits: number; piezas?: number }>,
    snapshotId?: string
  ) => void;
  toggleDeselect: (clave: string) => Promise<void>;
  batchToggleSelect: (claves: string[], select: boolean) => Promise<void>;

  // Permanent exclusion actions
  excludeProduct: (product: { clave: string; descripcion: string; proveedor: string }) => Promise<void>;
  includeProduct: (clave: string) => Promise<void>;

  confirmOrder: (selectedLines: OrderLineItem[]) => Promise<void>;

  deleteConfirmedOrder: (orderId: string) => Promise<void>;
  refreshHistory: () => Promise<void>;

  // Draft actions
  refreshDrafts: () => Promise<void>;
  getDraft: (id: string) => Promise<DraftOrder | null>;
  saveDraftFromLines: (lines: OrderLineItem[], name?: string) => Promise<string | null>;
  addLinesToDraft: (draftId: string, lines: OrderLineItem[]) => Promise<boolean>;
  updateDraft: (draft: DraftOrder) => Promise<void>;

  deleteDraft: (id: string) => Promise<void>;
  confirmDraft: (draft: DraftOrder) => Promise<void>;
}


const OrderContext = createContext<OrderContextType | undefined>(undefined);

export function OrderProvider({ children }: { children: React.ReactNode }) {
  const { approved } = useAuth();

  const [orderLines, setOrderLines] = useState<OrderLineItem[]>([]);
  const [deselectedClaves, setDeselectedClaves] = useState<Set<string>>(new Set());
  const [excludedProducts, setExcludedProducts] = useState<ExcludedProduct[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<ConfirmedOrder[]>([]);
  const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
  // Claves already confirmed in the current import cycle (shared, server-backed).
  // Replaces the old localStorage `belleza_confirmed_claves` key.
  const [confirmedClaves, setConfirmedClaves] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Refs mirror the live sets so synchronous builders read fresh values without
  // depending on state identity (avoids stale-closure bugs).
  const confirmedClavesRef = useRef<Set<string>>(new Set());
  const deselectedClavesRef = useRef<Set<string>>(new Set());

  const applyConfirmedClaves = useCallback((s: Set<string>) => {
    confirmedClavesRef.current = s;
    setConfirmedClaves(s);
  }, []);
  const applyDeselected = useCallback((s: Set<string>) => {
    deselectedClavesRef.current = s;
    setDeselectedClaves(s);
  }, []);

  // Fast lookup set of excluded product keys (clave), derived from the list.
  const excludedClaves = useMemo(
    () => new Set(excludedProducts.map((p) => p.clave)),
    [excludedProducts]
  );

  // Fast lookup set of claves that currently live inside a pending (draft)
  // order. These products are hidden from the live Total Order list until the
  // pending order is deleted or confirmed.
  const draftClaves = useMemo(
    () => new Set(draftOrders.flatMap((d) => d.items.map((i) => i.clave))),
    [draftOrders]
  );


  // Remember the inputs of the last snapshot build so exclude/include actions
  // can recompute the live order without requiring a fresh import.
  const lastBuildRef = useRef<{
    products: ProductSnapshot[];
    settingsMap?: Map<string, { minStockUnits: number; piezas?: number }>;
  } | null>(null);

  // ── Refresh helpers (stable) — single source of truth = Supabase ────────────
  const refreshHistory = useCallback(async () => {
    try {
      setConfirmedOrders(await ordersRepo.getConfirmedOrders());
    } catch (e) {
      console.error('refreshHistory error:', e);
    }
  }, []);

  const refreshDrafts = useCallback(async () => {
    try {
      setDraftOrders(await ordersRepo.getDraftOrders());
    } catch (e) {
      console.error('refreshDrafts error:', e);
    }
  }, []);

  const refreshExcluded = useCallback(async () => {
    try {
      setExcludedProducts(await ordersRepo.getExcludedProducts());
    } catch (e) {
      console.error('refreshExcluded error:', e);
    }
  }, []);

  const refreshDeselected = useCallback(async () => {
    try {
      applyDeselected(new Set(await ordersRepo.getDeselectedClaves()));
    } catch (e) {
      console.error('refreshDeselected error:', e);
    }
  }, [applyDeselected]);

  const refreshConfirmedClaves = useCallback(async () => {
    try {
      applyConfirmedClaves(new Set(await ordersRepo.getConfirmedClaves()));
    } catch (e) {
      console.error('refreshConfirmedClaves error:', e);
    }
  }, [applyConfirmedClaves]);

  // ── Initial load (gated on approval) + one-time device migration ────────────
  useEffect(() => {
    if (!approved) {
      // Not signed-in / not approved → clear everything (RLS hides it too). This
      // is a legitimate React↔external (auth) sync, so the set-state-in-effect
      // rule is intentionally suppressed here.
      /* eslint-disable react-hooks/set-state-in-effect */
      setOrderLines([]);
      applyDeselected(new Set());
      setExcludedProducts([]);
      applyConfirmedClaves(new Set());
      setConfirmedOrders([]);
      setDraftOrders([]);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }


    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        // Move this device's legacy IndexedDB/localStorage orders into Supabase
        // exactly once (self-guarded), then load the shared dataset.
        await migrateOrdersToSupabaseOnce();

        const [des, exc, conf, hist, drafts] = await Promise.all([
          ordersRepo.getDeselectedClaves(),
          ordersRepo.getExcludedProducts(),
          ordersRepo.getConfirmedClaves(),
          ordersRepo.getConfirmedOrders(),
          ordersRepo.getDraftOrders(),
        ]);
        if (cancelled) return;
        applyDeselected(new Set(des));
        setExcludedProducts(exc);
        applyConfirmedClaves(new Set(conf));
        setConfirmedOrders(hist);
        setDraftOrders(drafts);
      } catch (e) {
        console.error('OrderContext init error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [approved, applyDeselected, applyConfirmedClaves]);

  // ── Realtime: keep all clients in sync on every shared order table ──────────
  useEffect(() => {
    if (!approved) return;
    const unsubs = [
      subscribeTable('draft_orders', refreshDrafts),
      subscribeTable('draft_order_items', refreshDrafts),
      subscribeTable('confirmed_orders', refreshHistory),
      subscribeTable('order_items', refreshHistory),
      subscribeTable('excluded_products', refreshExcluded),
      subscribeTable('deselected_products', refreshDeselected),
      subscribeTable('confirmed_order_claves', refreshConfirmedClaves),
    ];
    return () => unsubs.forEach((u) => u());
  }, [approved, refreshDrafts, refreshHistory, refreshExcluded, refreshDeselected, refreshConfirmedClaves]);



  /**
   * Build order lines from the latest inventory snapshot.
   * Applies the exact ordering formula from the spec.
   * Excludes confirmed products (shared, server-backed) so they drop out of the
   * live Total Order list until a new import resets the cycle.
   */
  const buildOrderFromSnapshot = useCallback(
    (
      products: ProductSnapshot[],
      settingsMap?: Map<string, { minStockUnits: number; piezas?: number }>,
      // snapshotId kept for signature compatibility; the confirmed-claves reset
      // now happens server-side on every new import (see import RPCs).
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _snapshotId?: string

    ) => {
      // Confirmed claves are shared state now (mirrored in a ref for sync reads).
      const confirmedSet = confirmedClavesRef.current;

      // Remember the inputs so include/exclude actions can recompute the live
      // order on the fly (e.g. from the Orders page) without a fresh import.
      lastBuildRef.current = { products, settingsMap };

      // ── Build order lines ──────────────────────────────────────
      const lines: OrderLineItem[] = [];

      for (const p of products) {
        // Skip products already confirmed in this snapshot cycle
        if (confirmedSet.has(p.clave)) continue;

        // ⛔ Skip permanently-excluded products ("Do Not Order").
        if (excludedClaves.has(p.clave)) continue;

        // 🕓 Skip products already placed into a pending (draft) order.
        if (draftClaves.has(p.clave)) continue;

        const settings = settingsMap?.get(p.clave);


        const stockObjetivo = (settings?.minStockUnits && settings.minStockUnits > 0)
          ? settings.minStockUnits
          : (p.stockObjetivo ?? 0);
        const piezas = (settings?.piezas && settings.piezas > 0)
          ? settings.piezas
          : (p.piezas ?? 1);
        const currentStock = Math.max(0, p.existencia);
        const baseOrder = Math.max(0, stockObjetivo - currentStock);
        const unitsToOrder = adjustOrder(baseOrder, piezas);

        if (unitsToOrder > 0) {
          lines.push({
            clave: p.clave,
            descripcion: p.descripcion,
            proveedor: p.proveedor || 'General',
            currentStock,
            stockObjetivo,
            piezas,
            unitCost: p.precioC || 0,
            baseOrder,
            unitsToOrder,
            lineTotal: unitsToOrder * (p.precioC || 0),
            selected: !deselectedClaves.has(p.clave),
          });
        }
      }

      // Sort by supplier then description
      lines.sort((a, b) => {
        const supplierCmp = a.proveedor.localeCompare(b.proveedor);
        if (supplierCmp !== 0) return supplierCmp;
        return a.descripcion.localeCompare(b.descripcion);
      });

      setOrderLines(lines);
    },
    [deselectedClaves, excludedClaves, draftClaves]
  );


  /**
   * Recompute the live order from the last snapshot inputs, applying the
   * current confirmed / excluded / deselected sets. Used by include/exclude and
   * by realtime updates so the order updates even when the import page is not
   * mounted.
   */
  const rebuildFromLastInputs = useCallback(
    (excludedSet: Set<string>, deselectedSet: Set<string>, draftSet: Set<string> = new Set<string>()) => {

      const ref = lastBuildRef.current;
      if (!ref) return;

      const confirmedSet = confirmedClavesRef.current;

      const lines: OrderLineItem[] = [];
      for (const p of ref.products) {
        if (confirmedSet.has(p.clave)) continue;
        if (excludedSet.has(p.clave)) continue; // honour "Do Not Order"
        if (draftSet.has(p.clave)) continue;    // hide products in pending orders


        const settings = ref.settingsMap?.get(p.clave);
        const stockObjetivo = (settings?.minStockUnits && settings.minStockUnits > 0)
          ? settings.minStockUnits
          : (p.stockObjetivo ?? 0);
        const piezas = (settings?.piezas && settings.piezas > 0)
          ? settings.piezas
          : (p.piezas ?? 1);
        const currentStock = Math.max(0, p.existencia);
        const baseOrder = Math.max(0, stockObjetivo - currentStock);
        const unitsToOrder = adjustOrder(baseOrder, piezas);

        if (unitsToOrder > 0) {
          lines.push({
            clave: p.clave,
            descripcion: p.descripcion,
            proveedor: p.proveedor || 'General',
            currentStock,
            stockObjetivo,
            piezas,
            unitCost: p.precioC || 0,
            baseOrder,
            unitsToOrder,
            lineTotal: unitsToOrder * (p.precioC || 0),
            selected: !deselectedSet.has(p.clave),
          });
        }
      }

      lines.sort((a, b) => {
        const supplierCmp = a.proveedor.localeCompare(b.proveedor);
        if (supplierCmp !== 0) return supplierCmp;
        return a.descripcion.localeCompare(b.descripcion);
      });

      setOrderLines(lines);
    },
    []
  );

  // When the shared sets that ADD/REMOVE lines change (excluded / draft /
  // confirmed — including via realtime from another user), recompute the live
  // order from the last snapshot inputs.
  useEffect(() => {
    if (lastBuildRef.current) {
      rebuildFromLastInputs(excludedClaves, deselectedClavesRef.current, draftClaves);
    }
  }, [excludedClaves, draftClaves, confirmedClaves, rebuildFromLastInputs]);

  // When only the deselected set changes, just update the `selected` flags in
  // place (no full rebuild) so the existing lines stay put. This intentionally
  // syncs shared (server/realtime) deselect state into the local line view.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrderLines((prev) =>
      prev.map((l) => ({ ...l, selected: !deselectedClaves.has(l.clave) }))
    );
  }, [deselectedClaves]);


  // ─── Permanent product exclusion ("Do Not Order") ───────────────────────────

  const excludeProduct = useCallback(
    async (product: { clave: string; descripcion: string; proveedor: string }) => {
      try {
        const record: ExcludedProduct = {
          clave: product.clave,
          descripcion: product.descripcion,
          proveedor: product.proveedor || 'General',
          excludedAt: new Date().toISOString(),
        };
        await ordersRepo.excludeProduct(record);
        setExcludedProducts((prev) => [
          ...prev.filter((p) => p.clave !== record.clave),
          record,
        ]);
        // Drop it from the current order view right away
        setOrderLines((prev) => prev.filter((l) => l.clave !== record.clave));
        toast.success(`"${record.descripcion}" excluded from ordering`);
      } catch (e) {
        console.error(e);
        toast.error('Error excluding product');
      }
    },
    []
  );

  /** Re-enable ordering for a previously excluded product. */
  const includeProduct = useCallback(
    async (clave: string) => {
      try {
        await ordersRepo.includeProduct(clave);
        const nextExcluded = new Set(excludedClaves);
        nextExcluded.delete(clave);
        setExcludedProducts((prev) => prev.filter((p) => p.clave !== clave));
        // Rebuild so the product reappears in the order if still below target
        rebuildFromLastInputs(nextExcluded, deselectedClavesRef.current, draftClaves);
        toast.success('Ordering re-enabled');

      } catch (e) {
        console.error(e);
        toast.error('Error re-enabling product');
      }
    },
    [excludedClaves, draftClaves, rebuildFromLastInputs]
  );

  const toggleDeselect = useCallback(
    async (clave: string) => {
      try {
        const newSet = new Set(deselectedClavesRef.current);
        if (newSet.has(clave)) {
          newSet.delete(clave);
          await ordersRepo.reselect(clave);
        } else {
          newSet.add(clave);
          await ordersRepo.deselect(clave);
        }
        applyDeselected(newSet);
        setOrderLines((prev) =>
          prev.map((l) =>
            l.clave === clave ? { ...l, selected: !newSet.has(clave) } : l
          )
        );
      } catch (e) {
        console.error(e);
        toast.error('Error toggling product selection');
      }
    },
    [applyDeselected]
  );

  /**
   * Batch select or deselect multiple products at once.
   * This avoids the stale-state bug of calling toggleDeselect in a loop.
   */
  const batchToggleSelect = useCallback(
    async (claves: string[], select: boolean) => {
      if (claves.length === 0) return;
      try {
        await ordersRepo.setDeselected(claves, select);
        const newSet = new Set(deselectedClavesRef.current);
        for (const clave of claves) {
          if (select) newSet.delete(clave);
          else newSet.add(clave);
        }
        const clavesSet = new Set(claves);
        applyDeselected(newSet);
        setOrderLines((prev) =>
          prev.map((l) =>
            clavesSet.has(l.clave) ? { ...l, selected: select } : l
          )
        );
      } catch (e) {
        console.error(e);
        toast.error('Error updating product selection');
      }
    },
    [applyDeselected]
  );

  const confirmOrder = useCallback(
    async (selectedLines: OrderLineItem[]) => {
      if (selectedLines.length === 0) return;
      setLoading(true);

      try {
        const totalValue = selectedLines.reduce((s, l) => s + l.lineTotal, 0);
        const supplierName = selectedLines[0]?.proveedor || 'Mixed';

        const items: OrderItem[] = selectedLines.map((l) => ({
          orderId: '',
          clave: l.clave,
          descripcion: l.descripcion,
          proveedor: l.proveedor,
          currentStock: l.currentStock,
          unitsToOrder: l.unitsToOrder,
          unitCost: l.unitCost,
          lineTotal: l.lineTotal,
        }));

        // Atomic on the server: creates the confirmed order + items, marks the
        // claves confirmed, and clears their deselect flag.
        await ordersRepo.confirmOrderLines(supplierName, items);

        // Remove confirmed items from current order view immediately.
        const confirmedSet = new Set(selectedLines.map((l) => l.clave));
        setOrderLines((prev) => prev.filter((l) => !confirmedSet.has(l.clave)));

        // Reconcile shared state from the server.
        await Promise.all([
          refreshConfirmedClaves(),
          refreshHistory(),
          refreshDeselected(),
        ]);

        toast.success(`Order confirmed! ${selectedLines.length} products · $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      } catch (e) {
        toast.error('Error confirming order');
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [refreshConfirmedClaves, refreshHistory, refreshDeselected]
  );

  const deleteConfirmedOrder = useCallback(async (orderId: string) => {
    try {
      await ordersRepo.deleteConfirmedOrder(orderId);
      await refreshHistory();
      toast.success('Order removed from history');
    } catch (e) {
      console.error(e);
      toast.error('Error deleting order');
    }
  }, [refreshHistory]);

  // ─── Draft / Pending Orders ────────────────────────────────────────────────

  const getDraft = useCallback(async (id: string) => {
    return ordersRepo.getDraftOrder(id);
  }, []);

  /** Recompute totals + updatedAt for a draft's items. */
  const recomputeDraft = (draft: DraftOrder): DraftOrder => {
    const totalValue = draft.items.reduce((s, i) => s + i.lineTotal, 0);
    return {
      ...draft,
      totalProducts: draft.items.length,
      totalValue,
      updatedAt: new Date().toISOString(),
    };
  };

  /**
   * Create a NEW draft order from the currently selected order lines.
   * Returns the new draft id (or null when there is nothing to save).
   */
  const saveDraftFromLines = useCallback(
    async (lines: OrderLineItem[], name?: string): Promise<string | null> => {
      if (lines.length === 0) {
        toast.error('Nothing to save — select at least one product');
        return null;
      }
      try {
        const items: DraftOrderItem[] = lines.map((l) => ({
          clave: l.clave,
          descripcion: l.descripcion,
          proveedor: l.proveedor,
          currentStock: l.currentStock,
          unitsToOrder: l.unitsToOrder,
          unitCost: l.unitCost,
          lineTotal: l.lineTotal,
        }));

        // Derive supplier label
        const supplierSet = new Set(items.map((i) => i.proveedor));
        const supplierName =
          supplierSet.size === 1 ? Array.from(supplierSet)[0] : 'Mixed';

        const draft = await ordersRepo.createDraft({
          name: name?.trim() || `Pending Order · ${new Date().toLocaleString()}`,
          supplierName,
          items,
        });

        await refreshDrafts();

        // Hide the products that were moved into this pending order from the
        // live Total Order list right away.
        const savedClaves = new Set(items.map((i) => i.clave));
        setOrderLines((prev) => prev.filter((l) => !savedClaves.has(l.clave)));

        return draft.id;

      } catch (e) {
        console.error(e);
        toast.error('Error saving draft');
        return null;
      }
    },
    [refreshDrafts]
  );

  /**
   * Add the given order lines to an EXISTING pending order. Products already in
   * the pending order are skipped (no duplicates). The pending order totals are
   * recomputed and the added products are hidden from the live Total Order list.
   */
  const addLinesToDraft = useCallback(
    async (draftId: string, lines: OrderLineItem[]): Promise<boolean> => {
      if (lines.length === 0) {
        toast.error('Nothing to add — select at least one product');
        return false;
      }
      try {
        const existing = await ordersRepo.getDraftOrder(draftId);
        if (!existing) {
          toast.error('Pending order not found');
          return false;
        }

        const existingClaves = new Set(existing.items.map((i) => i.clave));
        const newItems: DraftOrderItem[] = lines
          .filter((l) => !existingClaves.has(l.clave))
          .map((l) => ({
            clave: l.clave,
            descripcion: l.descripcion,
            proveedor: l.proveedor,
            currentStock: l.currentStock,
            unitsToOrder: l.unitsToOrder,
            unitCost: l.unitCost,
            lineTotal: l.lineTotal,
          }));

        const mergedItems = [...existing.items, ...newItems];
        const supplierSet = new Set(mergedItems.map((i) => i.proveedor));
        const supplierName = supplierSet.size === 1 ? Array.from(supplierSet)[0] : 'Mixed';

        const updated: DraftOrder = {
          ...existing,
          supplierName,
          updatedAt: new Date().toISOString(),
          totalProducts: mergedItems.length,
          totalValue: mergedItems.reduce((s, i) => s + i.lineTotal, 0),
          items: mergedItems,
        };

        await ordersRepo.updateDraft(updated);
        await refreshDrafts();

        // Hide the products that were moved into this pending order from the
        // live Total Order list right away.
        const addedClaves = new Set(lines.map((l) => l.clave));
        setOrderLines((prev) => prev.filter((l) => !addedClaves.has(l.clave)));

        return true;
      } catch (e) {
        console.error(e);
        toast.error('Error adding to pending order');
        return false;
      }
    },
    [refreshDrafts]
  );

  /** Persist edits to an existing draft (quantities, added/removed products, name…). */
  const updateDraft = useCallback(
    async (draft: DraftOrder) => {
      try {
        const next = recomputeDraft(draft);
        await ordersRepo.updateDraft(next);
        // Refresh drafts and rebuild the live order: products added to the
        // pending order disappear, products removed from it reappear (if still
        // below target stock).
        const drafts = await ordersRepo.getDraftOrders();
        setDraftOrders(drafts);
        const allDraftClaves = new Set(drafts.flatMap((d) => d.items.map((i) => i.clave)));
        rebuildFromLastInputs(excludedClaves, deselectedClavesRef.current, allDraftClaves);
      } catch (e) {
        console.error(e);
        toast.error('Error saving changes');
      }
    },
    [excludedClaves, rebuildFromLastInputs]
  );

  const deleteDraft = useCallback(
    async (id: string) => {
      try {
        await ordersRepo.deleteDraftOrder(id);
        // Refresh drafts and rebuild so the freed products reappear in the
        // live Total Order list (if they are still below target stock).
        const drafts = await ordersRepo.getDraftOrders();
        setDraftOrders(drafts);
        const remaining = new Set(drafts.flatMap((d) => d.items.map((i) => i.clave)));
        rebuildFromLastInputs(excludedClaves, deselectedClavesRef.current, remaining);
      } catch (e) {
        console.error(e);
        toast.error('Error deleting draft');
      }
    },
    [excludedClaves, rebuildFromLastInputs]
  );


  /**
   * Confirm a draft: it becomes a real ConfirmedOrder (counted in dashboards /
   * history) and the draft is removed from the pending list. Atomic on server.
   */
  const confirmDraft = useCallback(
    async (draft: DraftOrder) => {
      if (draft.items.length === 0) {
        toast.error('Cannot confirm an empty draft');
        return;
      }
      setLoading(true);
      try {
        const totalValue = draft.items.reduce((s, i) => s + i.lineTotal, 0);

        await ordersRepo.confirmDraft(draft.id);

        // Mark these products as confirmed so they drop out of the live order
        const confirmedSet = new Set(draft.items.map((i) => i.clave));
        setOrderLines((prev) => prev.filter((l) => !confirmedSet.has(l.clave)));

        await Promise.all([
          refreshDrafts(),
          refreshHistory(),
          refreshConfirmedClaves(),
        ]);

        toast.success(`Order confirmed! ${draft.items.length} products · $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      } catch (e) {
        console.error(e);
        toast.error('Error confirming draft');
      } finally {
        setLoading(false);
      }
    },
    [refreshDrafts, refreshHistory, refreshConfirmedClaves]
  );

  return (
    <OrderContext.Provider
      value={{
        orderLines,
        deselectedClaves,
        excludedProducts,
        excludedClaves,
        confirmedOrders,
        draftOrders,
        loading,
        buildOrderFromSnapshot,
        toggleDeselect,
        batchToggleSelect,
        excludeProduct,
        includeProduct,
        confirmOrder,

        deleteConfirmedOrder,
        refreshHistory,
        refreshDrafts,
        getDraft,
        saveDraftFromLines,
        addLinesToDraft,
        updateDraft,

        deleteDraft,
        confirmDraft,
      }}
    >
      {children}
    </OrderContext.Provider>
  );
}


export function useOrder() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error('useOrder must be used within OrderProvider');
  return ctx;
}
