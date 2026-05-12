'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { ordersDB, ConfirmedOrder, OrderItem } from '@/lib/db/orders-db';
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

  // Confirmed order history
  confirmedOrders: ConfirmedOrder[];

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
  confirmOrder: (selectedLines: OrderLineItem[]) => Promise<void>;
  deleteConfirmedOrder: (orderId: string) => Promise<void>;
  refreshHistory: () => Promise<void>;
}

const OrderContext = createContext<OrderContextType | undefined>(undefined);

const CONFIRMED_KEY = 'belleza_confirmed_claves';
const CONFIRMED_SNAP_KEY = 'belleza_confirmed_snap_id';

export function OrderProvider({ children }: { children: React.ReactNode }) {
  const [orderLines, setOrderLines] = useState<OrderLineItem[]>([]);
  const [deselectedClaves, setDeselectedClaves] = useState<Set<string>>(new Set());
  const [confirmedOrders, setConfirmedOrders] = useState<ConfirmedOrder[]>([]);
  const [loading, setLoading] = useState(false);

  // Load deselected products and history on mount
  useEffect(() => {
    const load = async () => {
      try {
        await ordersDB.init();
        const claves = await ordersDB.getDeselectedClaves();
        setDeselectedClaves(new Set(claves));
        const history = await ordersDB.getConfirmedOrders();
        setConfirmedOrders(history);
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

      // ── Build order lines ──────────────────────────────────────
      const lines: OrderLineItem[] = [];

      for (const p of products) {
        // Skip products already confirmed in this snapshot cycle
        if (confirmedSet.has(p.clave)) continue;

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
    [deselectedClaves]
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

  return (
    <OrderContext.Provider
      value={{
        orderLines,
        deselectedClaves,
        confirmedOrders,
        loading,
        buildOrderFromSnapshot,
        toggleDeselect,
        batchToggleSelect,
        confirmOrder,
        deleteConfirmedOrder,
        refreshHistory,
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
