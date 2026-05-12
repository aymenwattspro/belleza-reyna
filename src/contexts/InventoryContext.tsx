'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { inventoryDB, SmartSaveResult } from '@/lib/db/inventory-db';
import { InventorySnapshot, ProductSnapshot } from '@/lib/types/inventory-timeline';

// ── Popularity / behaviour score ─────────────────────────────────────────────

export interface PopularityScore {
  clave: string;
  descripcion: string;
  proveedor: string;
  totalSales: number;
  salesVelocity: number;    // weekly equivalent (units/week)
  dailyVelocity: number;    // normalised units/day
  velocityAge: 'Active/Recent' | 'Normal' | 'Historical/Stale';
  consistencyScore: number;
  overallScore: number;
  trend: 'rising' | 'stable' | 'falling';
}

// ── Context shape ─────────────────────────────────────────────────────────────

interface InventoryContextType {
  // Data
  snapshots: InventorySnapshot[];       // Virtual snapshots from stock_history (for charts)
  latestSnapshot: InventorySnapshot | null; // Canonical current state from current_inventory
  popularityScores: PopularityScore[];

  // Loading
  loading: boolean;

  // Actions
  refreshData: () => Promise<void>;
  addSnapshot: (snapshot: InventorySnapshot, fileHash?: string) => Promise<SmartSaveResult>;
  deleteSnapshot: (snapshotId: string) => Promise<void>;
  clearAllData: () => Promise<void>;
  checkFileDuplicate: (fileHash: string) => Promise<boolean>;
  updateTargetStock: (updates: Map<string, { stockObjetivo: number; piezas: number }>) => Promise<number>;

  // Queries
  getProductHistory: (clave: string) => { date: Date; existencia: number }[];
  getPopularityScore: (clave: string) => PopularityScore | null;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export function InventoryProvider({ children }: { children: React.ReactNode }) {
  // Virtual snapshots (one per import, each only containing the CHANGED products)
  const [snapshots, setSnapshots] = useState<InventorySnapshot[]>([]);
  // Full current inventory (one row per unique product, with lastUpdatedDate)
  const [latestSnapshot, setLatestSnapshot] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Popularity scores ──────────────────────────────────────────────────────
  // Uses normalised daily velocity: stockDrop / daysBetweenImports
  // so a 10-unit drop over 2 days scores higher than 10 over 20 days.
  const popularityScores = React.useMemo((): PopularityScore[] => {
    if (snapshots.length < 2 || !latestSnapshot) return [];

    const scores: PopularityScore[] = [];

    for (const product of latestSnapshot.products) {
      // Collect every stock-change event for this product (oldest → newest)
      const history = snapshots
        .map(s => {
          const p = s.products.find(pr => pr.clave === product.clave);
          return p ? { date: s.date, existencia: p.existencia } : null;
        })
        .filter((h): h is { date: Date; existencia: number } => h !== null)
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      if (history.length < 2) continue; // Need at least 2 stock-change events

      // ── Normalised daily velocity ────────────────────────────────────────
      // For each consecutive pair, compute stockDrop / daysBetween.
      // Weight each period by its day count so long gaps don't distort the mean.
      let totalSales = 0;
      let weightedVelocitySum = 0;
      let totalDays = 0;
      let periodsWithDrop = 0;   // for drop-based consistency
      const periodVelocities: number[] = [];

      for (let i = 1; i < history.length; i++) {
        const drop = Math.max(0, history[i - 1].existencia - history[i].existencia);
        const days = Math.max(1,
          (history[i].date.getTime() - history[i - 1].date.getTime()) / 86_400_000
        );
        const v = drop / days; // units/day for this period
        totalSales += drop;
        weightedVelocitySum += v * days;
        totalDays += days;
        periodVelocities.push(v);
        if (drop > 0) periodsWithDrop++;
      }

      const dailyVelocity = totalDays > 0 ? weightedVelocitySum / totalDays : 0;
      const salesVelocity = dailyVelocity * 7; // weekly equivalent (for display)

      // Age label based on total span between first and last data point
      const spanDays = Math.max(1,
        (history[history.length - 1].date.getTime() - history[0].date.getTime()) / 86_400_000
      );
      const velocityAge: PopularityScore['velocityAge'] =
        spanDays < 7  ? 'Active/Recent' :
        spanDays > 30 ? 'Historical/Stale' : 'Normal';

      // ── Consistency = % of import intervals where stock actually dropped ──
      // "A product that drops every single time" → 100%.
      // This beats variance-based consistency which unfairly rewards products
      // with only 1 sale (they have 100% "consistent" but no real movement).
      const totalPeriods = periodVelocities.length;
      const consistencyScore = totalPeriods > 0 ? (periodsWithDrop / totalPeriods) * 100 : 0;

      // Trend: compare recent period velocities vs older period velocities
      const midpoint = Math.floor(periodVelocities.length / 2);
      const olderV  = periodVelocities.slice(0, midpoint);
      const recentV = periodVelocities.slice(-midpoint || undefined);
      const olderAvg  = olderV.reduce((a, b) => a + b, 0)  / (olderV.length  || 1);
      const recentAvg = recentV.reduce((a, b) => a + b, 0) / (recentV.length || 1);
      const trend: PopularityScore['trend'] =
        recentAvg > olderAvg * 1.2 ? 'rising' :
        recentAvg < olderAvg * 0.8 ? 'falling' : 'stable';

      // ── Overall score ────────────────────────────────────────────────────
      // 50% Weekly Velocity  (normalised 0-100: 2 units/day = 100%)
      // 30% Total Sales Volume (normalised 0-100: 100 units = 100%)
      // 20% Drop-Consistency   (already 0-100%)
      const overallScore =
        Math.min(100, salesVelocity / 0.14)  * 0.50 +  // 2u/day × 7 = 14u/week → ~100
        Math.min(100, totalSales)             * 0.30 +  // 100 units → 100%
        consistencyScore                      * 0.20;

      scores.push({
        clave: product.clave,
        descripcion: product.descripcion,
        proveedor: product.proveedor,
        totalSales,
        salesVelocity,
        dailyVelocity,
        velocityAge,
        consistencyScore,
        overallScore,
        trend,
      });
    }

    return scores.sort((a, b) => b.overallScore - a.overallScore);
  }, [snapshots, latestSnapshot]);

  // ── refreshData ────────────────────────────────────────────────────────────

  const refreshData = useCallback(async () => {
    try {
      setLoading(true);
      await inventoryDB.init();

      // One-time migration of existing snapshots/products → new stores
      await inventoryDB.migrateToV3IfNeeded();

      // ── Load import metadata ─────────────────────────────────────────────
      const importsList = await inventoryDB.getImports();

      // ── Load current inventory ───────────────────────────────────────────
      const currentItems = await inventoryDB.getCurrentInventory();

      // ── Load all stock history for virtual snapshots ─────────────────────
      const allHistory = await inventoryDB.getAllStockHistoryItems();

      // ── Build latestSnapshot from current_inventory ──────────────────────
      if (currentItems.length > 0) {
        const latestImport = importsList[0] ?? null;

        const products: ProductSnapshot[] = currentItems.map(p => ({
          clave: p.clave,
          descripcion: p.descripcion,
          existencia: Math.max(0, p.existencia),
          precioC: parseFloat(String(p.precioC)) || 0,
          precioV: p.precioV != null ? parseFloat(String(p.precioV)) : undefined,
          proveedor: p.proveedor || 'General',
          stockObjetivo: p.stockObjetivo != null ? parseFloat(String(p.stockObjetivo)) : undefined,
          piezas: p.piezas != null ? parseFloat(String(p.piezas)) : undefined,
          lastUpdatedDate: p.lastUpdatedDate ? new Date(p.lastUpdatedDate) : undefined,
          firstSeenDate: p.firstSeenDate ? new Date(p.firstSeenDate) : undefined,
          historyCount: p.historyCount ?? 1,
        }));

        setLatestSnapshot({
          id: latestImport?.id ?? 'current',
          date: latestImport ? new Date(latestImport.date) : new Date(),
          timestamp: latestImport?.timestamp ?? Date.now(),
          fileName: latestImport?.fileName ?? '',
          supplierName: latestImport?.supplierName,
          fileHash: latestImport?.fileHash,
          products,
        });
      } else {
        setLatestSnapshot(null);
      }

      // ── Build virtual snapshots from stock_history ────────────────────────
      // Each virtual snapshot contains only the products whose stock CHANGED
      // (or appeared for the first time) in that import.
      // This gives the behavior chart only real change-events as data points.
      const virtualSnapshots: InventorySnapshot[] = importsList.map(imp => {
        const productsInImport = allHistory
          .filter(h => h.importId === imp.id)
          .map(h => ({
            clave: h.clave,
            descripcion: h.descripcion,
            existencia: Math.max(0, h.existencia),
            precioC: parseFloat(String(h.precioC)) || 0,
            precioV: h.precioV != null ? parseFloat(String(h.precioV)) : undefined,
            proveedor: h.proveedor || 'General',
            stockObjetivo: h.stockObjetivo != null ? parseFloat(String(h.stockObjetivo)) : undefined,
            piezas: h.piezas != null ? parseFloat(String(h.piezas)) : undefined,
          }));

        return {
          id: imp.id,
          date: new Date(imp.date),
          timestamp: imp.timestamp,
          fileName: imp.fileName,
          supplierName: imp.supplierName,
          fileHash: imp.fileHash,
          products: productsInImport,
        };
      });

      setSnapshots(virtualSnapshots);
    } catch (error) {
      console.error('Error refreshing inventory data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── addSnapshot ────────────────────────────────────────────────────────────

  const addSnapshot = useCallback(async (
    snapshot: InventorySnapshot,
    _fileHash?: string,
  ): Promise<SmartSaveResult> => {
    const result = await inventoryDB.saveSnapshot({
      id: snapshot.id,
      timestamp: snapshot.timestamp,
      date: snapshot.date.toISOString(),
      fileName: snapshot.fileName,
      supplierName: snapshot.supplierName,
      fileHash: snapshot.fileHash ?? _fileHash,
      products: snapshot.products,
    });
    await refreshData();
    return result;
  }, [refreshData]);

  // ── checkFileDuplicate (now async) ─────────────────────────────────────────

  const checkFileDuplicate = useCallback(async (fileHash: string): Promise<boolean> => {
    return inventoryDB.isFileDuplicate(fileHash);
  }, []);

  // ── deleteSnapshot ─────────────────────────────────────────────────────────

  const deleteSnapshot = useCallback(async (snapshotId: string) => {
    await inventoryDB.deleteSnapshot(snapshotId);
    await refreshData();
  }, [refreshData]);

  // ── clearAllData ───────────────────────────────────────────────────────────

  const clearAllData = useCallback(async () => {
    await inventoryDB.clearAll();
    setSnapshots([]);
    setLatestSnapshot(null);
  }, []);

  // ── updateTargetStock ──────────────────────────────────────────────────────

  const updateTargetStock = useCallback(async (
    updates: Map<string, { stockObjetivo: number; piezas: number }>,
  ): Promise<number> => {
    const count = await inventoryDB.updateTargetStock(updates);
    await refreshData();
    return count;
  }, [refreshData]);

  // ── getProductHistory ──────────────────────────────────────────────────────
  // SYNC version: reads from already-loaded virtual snapshots
  // (stock_history data is embedded in each virtualSnapshot's products)

  const getProductHistory = useCallback((clave: string): { date: Date; existencia: number }[] => {
    return snapshots
      .map(s => {
        const p = s.products.find(pr => pr.clave === clave);
        return p ? { date: s.date, existencia: p.existencia } : null;
      })
      .filter((h): h is { date: Date; existencia: number } => h !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [snapshots]);

  // ── getPopularityScore ─────────────────────────────────────────────────────

  const getPopularityScore = useCallback((clave: string): PopularityScore | null => {
    return popularityScores.find(s => s.clave === clave) ?? null;
  }, [popularityScores]);

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  return (
    <InventoryContext.Provider
      value={{
        snapshots,
        latestSnapshot,
        popularityScores,
        loading,
        refreshData,
        addSnapshot,
        deleteSnapshot,
        clearAllData,
        checkFileDuplicate,
        updateTargetStock,
        getProductHistory,
        getPopularityScore,
      }}
    >
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const context = useContext(InventoryContext);
  if (!context) throw new Error('useInventory must be used within an InventoryProvider');
  return context;
}
