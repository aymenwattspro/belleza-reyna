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
import { ordersDB, ConfirmedOrder, OrderItem, DraftOrder, DraftOrderItem, ExcludedProduct } from '@/lib/db/orders-db';

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
  updateDraft: (draft: DraftOrder) => Promise<void>;
  deleteDraft: (id: string) => Promise<void>;
  confirmDraft: (draft: DraftOrder) => Promise<void>;
}


const OrderContext = createContext<OrderContextType | undefined>(undefined);

const CONFIRMED_KEY = 'belleza_confirmed_claves';
const CONFIRMED_SNAP_KEY = 'belleza_confirmed_snap_id';

export function OrderProvider({ children }: { children: React.ReactNode }) {
  const [orderLines, setOrderLines] = useState<OrderLineItem[]>([]);
  const [deselectedClaves, setDeselectedClaves] = useState<Set<string>>(new Set());
  const [excludedProducts, setExcludedProducts] = useState<ExcludedProduct[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<ConfirmedOrder[]>([]);
  const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
  const [loading, setLoading] = useState(false);

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

  // Load deselected products, excluded products, history and drafts on mount
  useEffect(() => {
    const load = async () => {
      try {
        await ordersDB.init();
        const claves = await ordersDB.getDeselectedClaves();
        setDeselectedClaves(new Set(claves));
        const excluded = await ordersDB.getExcludedProducts();
        setExcludedProducts(excluded);
        const history = await ordersDB.getConfirmedOrders();
        setConfirmedOrders(history);
        const drafts = await ordersDB.getDraftOrders();
        setDraftOrders(drafts);
      } catch (e) {
        console.error('OrderContext init error:', e);
      }
    };
    load();
  }, []);



  /**
   * Build order lines from the latest inventory snapshot.
   * Applies the exact ordering formula from the spec.
   * Excludes confirmed products (persisted across sessions).
   */
  const buildOrderFromSnapshot = useCallback(
    (
      products: ProductSnapshot[],
      settingsMap?: Map<string, { minStockUnits: number; piezas?: number }>,
      snapshotId?: string
    ) => {
      // ── Confirmed claves management ────────────────────────────
      // Read directly from localStorage (synchronous) to avoid stale state issues
      let confirmedSet = new Set<string>();
      try {
        if (snapshotId) {
          const storedSnapId = localStorage.getItem(CONFIRMED_SNAP_KEY);
          if (storedSnapId === snapshotId) {
            // Same snapshot — load persisted confirmed claves
            const raw = localStorage.getItem(CONFIRMED_KEY);
            confirmedSet = raw ? new Set(JSON.parse(raw)) : new Set();
          } else {
            // New snapshot imported — clear confirmed claves
            localStorage.removeItem(CONFIRMED_KEY);
            localStorage.setItem(CONFIRMED_SNAP_KEY, snapshotId);
          }
        } else {
          // No snapshotId provided — load whatever is stored
          const raw = localStorage.getItem(CONFIRMED_KEY);
          confirmedSet = raw ? new Set(JSON.parse(raw)) : new Set();
        }
      } catch {
        confirmedSet = new Set();
      }

      // Remember the inputs so include/exclude actions can recompute the live
      // order on the fly (e.g. from the Orders page) without a fresh import.
      lastBuildRef.current = { products, settingsMap };

      // ── Build order lines ──────────────────────────────────────
      const lines: OrderLineItem[] = [];

      for (const p of products) {
        // Skip products already confirmed in this snapshot cycle
        if (confirmedSet.has(p.clave)) continue;

        // ⛔ Skip permanently-excluded products ("Do Not Order").
        // Keyed by the stable `clave`, this guarantees the product NEVER
        // appears in the Total Order list, NEVER contributes to total units or
        // cost, and that its target-stock shortage is ignored — even right
        // after a fresh dataset import.
        if (excludedClaves.has(p.clave)) continue;

        // 🕓 Skip products already placed into a pending (draft) order — they
        // are hidden from the live Total Order list until the pending order is
        // deleted or confirmed.
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
   * current confirmed / excluded / deselected sets. Used by include/exclude so
   * the order updates even when the import page is not mounted.
   */
  const rebuildFromLastInputs = useCallback(
    (excludedSet: Set<string>, deselectedSet: Set<string>, draftSet: Set<string> = new Set<string>()) => {

      const ref = lastBuildRef.current;
      if (!ref) return;

      let confirmedSet = new Set<string>();
      try {
        const raw = localStorage.getItem(CONFIRMED_KEY);
        confirmedSet = raw ? new Set(JSON.parse(raw)) : new Set();
      } catch {
        confirmedSet = new Set();
      }

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

  // ─── Permanent product exclusion ("Do Not Order") ───────────────────────────

  /**
   * Permanently exclude a product from ordering. It is removed from the live
   * order immediately and persisted (keyed by clave) so it stays excluded
   * across dataset imports and app reloads.
   */
  const excludeProduct = useCallback(
    async (product: { clave: string; descripcion: string; proveedor: string }) => {
      try {
        const record: ExcludedProduct = {
          clave: product.clave,
          descripcion: product.descripcion,
          proveedor: product.proveedor || 'General',
          excludedAt: new Date().toISOString(),
        };
        await ordersDB.excludeProduct(record);
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
        await ordersDB.includeProduct(clave);
        const nextExcluded = new Set(excludedClaves);
        nextExcluded.delete(clave);
        setExcludedProducts((prev) => prev.filter((p) => p.clave !== clave));
        // Rebuild so the product reappears in the order if still below target
        rebuildFromLastInputs(nextExcluded, deselectedClaves, draftClaves);
        toast.success('Ordering re-enabled');

      } catch (e) {
        console.error(e);
        toast.error('Error re-enabling product');
      }
    },
    [excludedClaves, deselectedClaves, draftClaves, rebuildFromLastInputs]
  );

  const toggleDeselect = useCallback(


    async (clave: string) => {
      try {
        const newSet = new Set(deselectedClaves);
        if (newSet.has(clave)) {
          newSet.delete(clave);
          await ordersDB.reselect(clave);
        } else {
          newSet.add(clave);
          await ordersDB.deselect(clave);
        }
        setDeselectedClaves(newSet);
        setOrderLines((prev) =>
          prev.map((l) =>
            l.clave === clave ? { ...l, selected: !newSet.has(clave) } : l
          )
        );
      } catch (e) {
        toast.error('Error toggling product selection');
      }
    },
    [deselectedClaves]
  );

  /**
   * Batch select or deselect multiple products at once.
   * This avoids the stale-state bug of calling toggleDeselect in a loop.
   */
  const batchToggleSelect = useCallback(
    async (claves: string[], select: boolean) => {
      if (claves.length === 0) return;
      try {
        const newSet = new Set(deselectedClaves);
        for (const clave of claves) {
          if (select) {
            newSet.delete(clave);
            await ordersDB.reselect(clave);
          } else {
            newSet.add(clave);
            await ordersDB.deselect(clave);
          }
        }
        const clavesSet = new Set(claves);
        setDeselectedClaves(newSet);
        setOrderLines((prev) =>
          prev.map((l) =>
            clavesSet.has(l.clave) ? { ...l, selected: select } : l
          )
        );
      } catch (e) {
        toast.error('Error updating product selection');
      }
    },
    [deselectedClaves]
  );

  const confirmOrder = useCallback(
    async (selectedLines: OrderLineItem[]) => {
      if (selectedLines.length === 0) return;
      setLoading(true);

      try {
        const orderId = `ord_${Date.now()}`;
        const totalValue = selectedLines.reduce((s, l) => s + l.lineTotal, 0);

        const confirmed: ConfirmedOrder = {
          id: orderId,
          confirmedAt: new Date().toISOString(),
          supplierName: selectedLines[0]?.proveedor || 'Mixed',
          totalProducts: selectedLines.length,
          totalValue,
          items: selectedLines.map((l) => ({
            orderId,
            clave: l.clave,
            descripcion: l.descripcion,
            proveedor: l.proveedor,
            currentStock: l.currentStock,
            unitsToOrder: l.unitsToOrder,
            unitCost: l.unitCost,
            lineTotal: l.lineTotal,
          })),
        };

        await ordersDB.saveConfirmedOrder(confirmed);

        // ── Persist confirmed claves ───────────────────────────
        const confirmedClaves = new Set(selectedLines.map((l) => l.clave));
        try {
          const raw = localStorage.getItem(CONFIRMED_KEY);
          const existing: string[] = raw ? JSON.parse(raw) : [];
          const merged = Array.from(new Set([...existing, ...Array.from(confirmedClaves)]));
          localStorage.setItem(CONFIRMED_KEY, JSON.stringify(merged));
        } catch {}

        // Remove confirmed items from current order view
        setOrderLines((prev) => prev.filter((l) => !confirmedClaves.has(l.clave)));

        // Clear deselected for the confirmed items (cleanup)
        for (const clave of confirmedClaves) {
          await ordersDB.reselect(clave);
        }
        const newDeselected = new Set([...deselectedClaves]);
        confirmedClaves.forEach((c) => newDeselected.delete(c));
        setDeselectedClaves(newDeselected);

        // Refresh history
        const history = await ordersDB.getConfirmedOrders();
        setConfirmedOrders(history);

        toast.success(`Order confirmed! ${selectedLines.length} products · $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      } catch (e) {
        toast.error('Error confirming order');
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [deselectedClaves]
  );

  const deleteConfirmedOrder = useCallback(async (orderId: string) => {
    try {
      await ordersDB.deleteConfirmedOrder(orderId);
      const history = await ordersDB.getConfirmedOrders();
      setConfirmedOrders(history);
      toast.success('Order removed from history');
    } catch (e) {
      toast.error('Error deleting order');
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    const history = await ordersDB.getConfirmedOrders();
    setConfirmedOrders(history);
  }, []);

  // ─── Draft / Pending Orders ────────────────────────────────────────────────

  const refreshDrafts = useCallback(async () => {
    const drafts = await ordersDB.getDraftOrders();
    setDraftOrders(drafts);
  }, []);

  const getDraft = useCallback(async (id: string) => {
    return ordersDB.getDraftOrder(id);
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
   * Drafts are kept fully separate from confirmed orders — they never
   * affect dashboards, metrics or history until confirmed.
   */
  const saveDraftFromLines = useCallback(
    async (lines: OrderLineItem[], name?: string): Promise<string | null> => {
      if (lines.length === 0) {
        toast.error('Nothing to save — select at least one product');
        return null;
      }
      try {
        const id = `draft_${Date.now()}`;
        const now = new Date().toISOString();
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

        const draft: DraftOrder = {
          id,
          name: name?.trim() || `Draft · ${new Date().toLocaleString()}`,
          supplierName,
          createdAt: now,
          updatedAt: now,
          totalProducts: items.length,
          totalValue: items.reduce((s, i) => s + i.lineTotal, 0),
          items,
        };

        await ordersDB.saveDraftOrder(draft);
        await refreshDrafts();

        // Hide the products that were moved into this pending order from the
        // live Total Order list right away.
        const savedClaves = new Set(items.map((i) => i.clave));
        setOrderLines((prev) => prev.filter((l) => !savedClaves.has(l.clave)));

        return id;

      } catch (e) {
        console.error(e);
        toast.error('Error saving draft');
        return null;
      }
    },
    [refreshDrafts]
  );

  /** Persist edits to an existing draft (quantities, added/removed products, name…). */
  const updateDraft = useCallback(
    async (draft: DraftOrder) => {
      try {
        const next = recomputeDraft(draft);
        await ordersDB.saveDraftOrder(next);
        // Refresh drafts and rebuild the live order: products added to the
        // pending order disappear, products removed from it reappear (if still
        // below target stock).
        const drafts = await ordersDB.getDraftOrders();
        setDraftOrders(drafts);
        const allDraftClaves = new Set(drafts.flatMap((d) => d.items.map((i) => i.clave)));
        rebuildFromLastInputs(excludedClaves, deselectedClaves, allDraftClaves);
      } catch (e) {
        console.error(e);
        toast.error('Error saving changes');
      }
    },
    [excludedClaves, deselectedClaves, rebuildFromLastInputs]
  );

  const deleteDraft = useCallback(
    async (id: string) => {
      try {
        await ordersDB.deleteDraftOrder(id);
        // Refresh drafts and rebuild so the freed products reappear in the
        // live Total Order list (if they are still below target stock).
        const drafts = await ordersDB.getDraftOrders();
        setDraftOrders(drafts);
        const remaining = new Set(drafts.flatMap((d) => d.items.map((i) => i.clave)));
        rebuildFromLastInputs(excludedClaves, deselectedClaves, remaining);
      } catch (e) {
        toast.error('Error deleting draft');
      }
    },
    [excludedClaves, deselectedClaves, rebuildFromLastInputs]
  );


  /**
   * Confirm a draft: it becomes a real ConfirmedOrder (counted in dashboards /
   * history) and the draft is removed from the pending list.
   */
  const confirmDraft = useCallback(
    async (draft: DraftOrder) => {
      if (draft.items.length === 0) {
        toast.error('Cannot confirm an empty draft');
        return;
      }
      setLoading(true);
      try {
        const orderId = `ord_${Date.now()}`;
        const totalValue = draft.items.reduce((s, i) => s + i.lineTotal, 0);

        const confirmed: ConfirmedOrder = {
          id: orderId,
          confirmedAt: new Date().toISOString(),
          supplierName: draft.supplierName || 'Mixed',
          totalProducts: draft.items.length,
          totalValue,
          items: draft.items.map((i) => ({
            orderId,
            clave: i.clave,
            descripcion: i.descripcion,
            proveedor: i.proveedor,
            currentStock: i.currentStock,
            unitsToOrder: i.unitsToOrder,
            unitCost: i.unitCost,
            lineTotal: i.lineTotal,
          })),
        };

        await ordersDB.saveConfirmedOrder(confirmed);
        await ordersDB.deleteDraftOrder(draft.id);

        // Mark these products as confirmed so they drop out of the live order
        const confirmedClaves = new Set(draft.items.map((i) => i.clave));
        try {
          const raw = localStorage.getItem(CONFIRMED_KEY);
          const existing: string[] = raw ? JSON.parse(raw) : [];
          const merged = Array.from(new Set([...existing, ...Array.from(confirmedClaves)]));
          localStorage.setItem(CONFIRMED_KEY, JSON.stringify(merged));
        } catch {}
        setOrderLines((prev) => prev.filter((l) => !confirmedClaves.has(l.clave)));

        await refreshDrafts();
        const history = await ordersDB.getConfirmedOrders();
        setConfirmedOrders(history);

        toast.success(`Order confirmed! ${draft.items.length} products · $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      } catch (e) {
        console.error(e);
        toast.error('Error confirming draft');
      } finally {
        setLoading(false);
      }
    },
    [refreshDrafts]
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
