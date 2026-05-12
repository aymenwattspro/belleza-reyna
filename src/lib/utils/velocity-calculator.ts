// Calculate product velocity and behavior analysis
import { format, differenceInDays } from 'date-fns';
import { ProductVelocity, ProductHistory, InventorySnapshot } from '@/lib/types/inventory-timeline';

interface VelocityConfig {
  slowMoverThreshold: number; // Percentage change threshold (default 5%)
  velocityWeeks: number; // Number of weeks to calculate velocity (default 1)
}

const DEFAULT_CONFIG: VelocityConfig = {
  slowMoverThreshold: 0.05, // 5%
  velocityWeeks: 1
};

/**
 * Calculate weekly sales velocity for a product
 * Based on stock changes between snapshots
 */
export function calculateVelocity(
  history: { date: Date; existencia: number }[],
  config: VelocityConfig = DEFAULT_CONFIG
): ProductVelocity {
  if (history.length < 2) {
    return {
      clave: '',
      descripcion: '',
      weeklyVelocity: 0,
      isSlowMover: true,
      stockTrend: 'stable',
      last5Snapshots: history.slice(0, 5).map(h => ({
        date: h.date,
        existencia: h.existencia
      }))
    };
  }

  // Sort by date ascending
  const sortedHistory = [...history].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Calculate total velocity (units sold per week)
  const oldest = sortedHistory[0];
  const newest = sortedHistory[sortedHistory.length - 1];

  const daysDiff = differenceInDays(newest.date, oldest.date);
  const weeksDiff = daysDiff / 7 || 1; // Avoid division by zero

  const stockChange = oldest.existencia - newest.existencia; // Positive = sold, Negative = received
  const weeklyVelocity = stockChange > 0 ? stockChange / weeksDiff : 0;

  // Determine trend
  const recentChange = sortedHistory.length >= 2
    ? sortedHistory[sortedHistory.length - 2].existencia - newest.existencia
    : 0;

  let stockTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (recentChange > config.slowMoverThreshold * newest.existencia) {
    stockTrend = 'decreasing';
  } else if (recentChange < -config.slowMoverThreshold * newest.existencia) {
    stockTrend = 'increasing';
  }

  // Check if slow mover (stock hasn't changed > 5% in last 2 snapshots)
  let isSlowMover = true;
  if (sortedHistory.length >= 2) {
    const recent = sortedHistory.slice(-2);
    const changePercent = Math.abs((recent[1].existencia - recent[0].existencia) / recent[0].existencia);
    isSlowMover = changePercent < config.slowMoverThreshold || isNaN(changePercent);
  }

  return {
    clave: '',
    descripcion: '',
    weeklyVelocity,
    isSlowMover,
    stockTrend,
    last5Snapshots: sortedHistory.slice(-5).map(h => ({
      date: h.date,
      existencia: h.existencia
    }))
  };
}

/**
 * Build product history from multiple snapshots
 */
export function buildProductHistory(
  clave: string,
  snapshots: { id: string; date: Date; products: { clave: string; existencia: number; descripcion: string; proveedor: string }[] }[]
): ProductHistory {
  const historyPoints = snapshots
    .map(snapshot => {
      const product = snapshot.products.find(p => p.clave === clave);
      if (!product) return null;

      return {
        snapshotId: snapshot.id,
        date: snapshot.date,
        existencia: product.existencia
      };
    })
    .filter((point): point is NonNullable<typeof point> => point !== null);

  // Get product info from most recent snapshot
  const mostRecent = snapshots[snapshots.length - 1];
  const productInfo = mostRecent?.products.find(p => p.clave === clave);

  return {
    clave,
    descripcion: productInfo?.descripcion || clave,
    proveedor: productInfo?.proveedor || 'General',
    snapshots: historyPoints.sort((a, b) => b.date.getTime() - a.date.getTime())
  };
}

/**
 * Identify all slow movers across the inventory
 */
export function identifySlowMovers(
  products: { clave: string; descripcion: string; proveedor: string }[],
  getProductHistory: (clave: string) => { date: Date; existencia: number }[]
): ProductVelocity[] {
  return products.map(product => {
    const history = getProductHistory(product.clave);
    const velocity = calculateVelocity(history);

    return {
      ...velocity,
      clave: product.clave,
      descripcion: product.descripcion
    };
  }).filter(v => v.isSlowMover);
}

/**
 * Format velocity for display
 */
export function formatVelocity(velocity: number): string {
  if (velocity === 0) return 'Sin ventas';
  if (velocity < 1) return '< 1 por semana';
  return `${velocity.toFixed(1)} por semana`;
}

/**
 * Predict stockout date based on velocity
 */
export function predictStockout(
  currentStock: number,
  weeklyVelocity: number
): Date | null {
  if (weeklyVelocity <= 0) return null;

  const weeksUntilStockout = currentStock / weeklyVelocity;
  const daysUntilStockout = weeksUntilStockout * 7;

  const stockoutDate = new Date();
  stockoutDate.setDate(stockoutDate.getDate() + daysUntilStockout);

  return stockoutDate;
}
