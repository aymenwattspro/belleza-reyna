'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard, TrendingUp, Package, DollarSign, ShoppingCart,
  Star, Zap, Activity, Ghost, ArrowRight, BarChart3, Trophy,
  AlertTriangle, TrendingDown, Target, Layers, Info, X,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import { cn } from '@/lib/utils';
import { useInventory } from '@/contexts/InventoryContext';
import { useOrder } from '@/contexts/OrderContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { getStockStatus } from '@/lib/utils/adjust-order';
import { format } from 'date-fns';

const CHART_COLORS = [
  '#ec4899', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#8b5cf6', '#e11d48', '#84cc16', '#14b8a6', '#6366f1',
];

// Uses global InventoryProvider from app/layout.tsx
export default function DashboardPage() {
  const { latestSnapshot, popularityScores, snapshots } = useInventory();
  const { orderLines, confirmedOrders } = useOrder();
  const [activeKpiModal, setActiveKpiModal] = useState<string | null>(null);
  const { t } = useLanguage();

  // ── Current inventory value (cost × stock) ────────────────────────────────
  const inventoryValue = useMemo(() => {
    if (!latestSnapshot) return 0;
    return latestSnapshot.products.reduce(
      (sum, p) => sum + Math.max(0, p.existencia) * (p.precioC || 0),
      0
    );
  }, [latestSnapshot]);

  // ── Current order value (selected items only) ─────────────────────────────
  const currentOrderValue = useMemo(
    () => orderLines.filter((l) => l.selected).reduce((s, l) => s + l.lineTotal, 0),
    [orderLines]
  );

  // ── Top 10 most ordered products (from confirmed history) ─────────────────
  const top10Products = useMemo(() => {
    const allItems = confirmedOrders.flatMap((o) => o.items);
    const map = new Map<string, { descripcion: string; proveedor: string; totalOrdered: number; totalValue: number }>();

    for (const item of allItems) {
      const existing = map.get(item.clave);
      if (existing) {
        existing.totalOrdered += item.unitsToOrder;
        existing.totalValue += item.lineTotal;
      } else {
        map.set(item.clave, {
          descripcion: item.descripcion,
          proveedor: item.proveedor,
          totalOrdered: item.unitsToOrder,
          totalValue: item.lineTotal,
        });
      }
    }

    return [...map.entries()]
      .map(([clave, data]) => ({ clave, ...data }))
      .sort((a, b) => b.totalOrdered - a.totalOrdered)
      .slice(0, 10);
  }, [confirmedOrders]);

  // ── Stock status breakdown ─────────────────────────────────────────────────
  const stockBreakdown = useMemo(() => {
    if (!latestSnapshot) return { red: 0, orange: 0, green: 0 };
    let red = 0, orange = 0, green = 0;
    for (const p of latestSnapshot.products) {
      const status = getStockStatus(Math.max(0, p.existencia), p.stockObjetivo || 0);
      if (status === 'red') red++;
      else if (status === 'orange') orange++;
      else green++;
    }
    return { red, orange, green };
  }, [latestSnapshot]);

  // ── New KPIs ───────────────────────────────────────────────────────────────
  const advancedKPIs = useMemo(() => {
    if (!latestSnapshot || latestSnapshot.products.length === 0) return null;
    const products = latestSnapshot.products;

    // Products that have a target set
    const withTarget = products.filter(p => (p.stockObjetivo ?? 0) > 0);

    // Stock Fulfillment Index (SFI): Σ current / Σ target for products with target
    const totalCurrentStock = withTarget.reduce((s, p) => s + Math.max(0, p.existencia), 0);
    const totalTargetStock = withTarget.reduce((s, p) => s + (p.stockObjetivo ?? 0), 0);
    const sfi = totalTargetStock > 0 ? (totalCurrentStock / totalTargetStock) * 100 : null;

    // OOS Rate: products at 0 / total products
    const oosCount = products.filter(p => p.existencia <= 0).length;
    const oosRate = (oosCount / products.length) * 100;

    // Capital Gap: Σ max(0, target - current) × cost for below-target products
    const capitalGap = withTarget
      .filter(p => p.existencia < (p.stockObjetivo ?? 0))
      .reduce((s, p) => s + Math.max(0, (p.stockObjetivo ?? 0) - Math.max(0, p.existencia)) * (p.precioC || 0), 0);

    // Overstock: products where current > target (and target > 0)
    const overstockProducts = withTarget.filter(p => Math.max(0, p.existencia) > (p.stockObjetivo ?? 0));

    return { sfi, oosRate, oosCount, capitalGap, overstockCount: overstockProducts.length, totalProducts: products.length, withTargetCount: withTarget.length };
  }, [latestSnapshot]);

  // ── Overstock products list (sorted by excess units desc) ─────────────────
  const overstockProductsList = useMemo(() => {
    if (!latestSnapshot) return [];
    return latestSnapshot.products
      .filter(p => (p.stockObjetivo ?? 0) > 0 && Math.max(0, p.existencia) > (p.stockObjetivo ?? 0))
      .map(p => ({
        clave: p.clave,
        descripcion: p.descripcion,
        proveedor: p.proveedor || 'General',
        stock: Math.max(0, p.existencia),
        target: p.stockObjetivo ?? 0,
        excess: Math.max(0, p.existencia) - (p.stockObjetivo ?? 0),
        excessValue: (Math.max(0, p.existencia) - (p.stockObjetivo ?? 0)) * (p.precioC || 0),
      }))
      .sort((a, b) => b.excess - a.excess);
  }, [latestSnapshot]);

  // ── Supplier breakdown ────────────────────────────────────────────────────
  const supplierBreakdown = useMemo(() => {
    if (!latestSnapshot) return [];
    const map = new Map<string, { count: number; value: number }>();
    for (const p of latestSnapshot.products) {
      const s = p.proveedor || 'Unknown';
      const ex = map.get(s) || { count: 0, value: 0 };
      ex.count++;
      ex.value += Math.max(0, p.existencia) * (p.precioC || 0);
      map.set(s, ex);
    }
    return [...map.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [latestSnapshot]);

  // ── Top popular products (for behavior analysis) ──────────────────────────
  const topPopular = popularityScores.slice(0, 5);

  const getMovementIcon = (score: number) => {
    if (score >= 70) return { icon: Zap, color: 'text-emerald-500', label: 'Fast' };
    if (score >= 30) return { icon: Activity, color: 'text-blue-500', label: 'Steady' };
    return { icon: Ghost, color: 'text-gray-400', label: 'Slow' };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <LayoutDashboard size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-xs text-gray-500">
                {latestSnapshot
                  ? `Last updated: ${format(latestSnapshot.date, 'dd MMM yyyy HH:mm')}`
                  : 'No inventory data yet'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* ── KPI Row 1: Core metrics ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Inventory Value */}
          <button onClick={() => setActiveKpiModal('inventory_value')}
            className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-md hover:border-violet-200 transition-all cursor-pointer text-left group">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-gray-500">
                <DollarSign size={16} className="text-violet-500" />
                <span className="text-xs font-semibold uppercase tracking-wide">Inventory Value</span>
              </div>
              <Info size={13} className="text-gray-300 group-hover:text-violet-400 transition-colors" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              ${inventoryValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {latestSnapshot?.products.length || 0} products
            </p>
          </button>

          {/* Current Order Value */}
          <button onClick={() => setActiveKpiModal('pending_order')}
            className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-md hover:border-pink-200 transition-all cursor-pointer text-left group">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-gray-500">
                <ShoppingCart size={16} className="text-pink-500" />
                <span className="text-xs font-semibold uppercase tracking-wide">Pending Order</span>
              </div>
              <Info size={13} className="text-gray-300 group-hover:text-pink-400 transition-colors" />
            </div>
            <p className="text-2xl font-bold text-pink-700">
              ${currentOrderValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {orderLines.filter((l) => l.selected).length} items to order
            </p>
          </button>

          {/* Stock Alerts */}
          <button onClick={() => setActiveKpiModal('stock_alerts')}
            className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-md hover:border-red-200 transition-all cursor-pointer text-left group">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-gray-500">
                <Package size={16} className="text-red-500" />
                <span className="text-xs font-semibold uppercase tracking-wide">Stock Alerts</span>
              </div>
              <Info size={13} className="text-gray-300 group-hover:text-red-400 transition-colors" />
            </div>
            <div className="flex items-end gap-2">
              <p className="text-2xl font-bold text-red-600">{stockBreakdown.red}</p>
              <p className="text-sm text-orange-500 font-bold mb-0.5">+{stockBreakdown.orange}</p>
            </div>
            <p className="text-xs text-gray-400 mt-1">Out · Low stock</p>
          </button>

          {/* Confirmed Orders */}
          <button onClick={() => setActiveKpiModal('confirmed_orders')}
            className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-md hover:border-emerald-200 transition-all cursor-pointer text-left group">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-gray-500">
                <TrendingUp size={16} className="text-emerald-500" />
                <span className="text-xs font-semibold uppercase tracking-wide">Confirmed Orders</span>
              </div>
              <Info size={13} className="text-gray-300 group-hover:text-emerald-400 transition-colors" />
            </div>
            <p className="text-2xl font-bold text-emerald-700">{confirmedOrders.length}</p>
            <p className="text-xs text-gray-400 mt-1">
              {confirmedOrders.length > 0
                ? `Last: ${format(new Date(confirmedOrders[0].confirmedAt), 'dd MMM')}`
                : 'No orders yet'}
            </p>
          </button>
        </div>

        {/* ── KPI Row 2: Advanced metrics ── */}
        {advancedKPIs && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Stock Fulfillment Index */}
            <button onClick={() => setActiveKpiModal('sfi')}
              className={cn(
                'rounded-2xl p-5 border shadow-sm hover:shadow-md transition-all cursor-pointer text-left group',
                advancedKPIs.sfi === null ? 'bg-gray-50 border-gray-200' :
                advancedKPIs.sfi >= 80 ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300' :
                advancedKPIs.sfi >= 50 ? 'bg-orange-50 border-orange-200 hover:border-orange-300' :
                'bg-red-50 border-red-200 hover:border-red-300'
              )}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Target size={16} className={
                    advancedKPIs.sfi === null ? 'text-gray-400' :
                    advancedKPIs.sfi >= 80 ? 'text-emerald-600' :
                    advancedKPIs.sfi >= 50 ? 'text-orange-500' : 'text-red-500'
                  } />
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Stock Fulfillment</span>
                </div>
                <Info size={13} className="text-gray-300 group-hover:text-indigo-300 transition-colors" />
              </div>
              <p className={cn(
                'text-2xl font-bold',
                advancedKPIs.sfi === null ? 'text-gray-400' :
                advancedKPIs.sfi >= 80 ? 'text-emerald-700' :
                advancedKPIs.sfi >= 50 ? 'text-orange-600' : 'text-red-700'
              )}>
                {advancedKPIs.sfi !== null ? `${advancedKPIs.sfi.toFixed(1)}%` : '—'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Tracking <span className="font-semibold text-gray-600">{advancedKPIs.withTargetCount}</span> of <span className="font-semibold text-gray-600">{advancedKPIs.totalProducts}</span> products
              </p>
            </button>

            {/* OOS Rate */}
            <button onClick={() => setActiveKpiModal('oos_rate')}
              className={cn(
                'rounded-2xl p-5 border shadow-sm hover:shadow-md transition-all cursor-pointer text-left group',
                advancedKPIs.oosRate === 0 ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300' :
                advancedKPIs.oosRate < 10 ? 'bg-orange-50 border-orange-200 hover:border-orange-300' :
                'bg-red-50 border-red-200 hover:border-red-300'
              )}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className={
                    advancedKPIs.oosRate === 0 ? 'text-emerald-600' :
                    advancedKPIs.oosRate < 10 ? 'text-orange-500' : 'text-red-500'
                  } />
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">OOS Rate</span>
                </div>
                <Info size={13} className="text-gray-300 group-hover:text-orange-300 transition-colors" />
              </div>
              <p className={cn(
                'text-2xl font-bold',
                advancedKPIs.oosRate === 0 ? 'text-emerald-700' :
                advancedKPIs.oosRate < 10 ? 'text-orange-600' : 'text-red-700'
              )}>
                {advancedKPIs.oosRate.toFixed(1)}%
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {advancedKPIs.oosCount} of {advancedKPIs.totalProducts} products at 0
              </p>
            </button>

            {/* Capital Gap */}
            <button onClick={() => setActiveKpiModal('capital_gap')}
              className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer text-left group">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <TrendingDown size={16} className="text-indigo-500" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Capital Gap</span>
                </div>
                <Info size={13} className="text-gray-300 group-hover:text-indigo-400 transition-colors" />
              </div>
              <p className="text-2xl font-bold text-indigo-700">
                ${advancedKPIs.capitalGap.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-gray-400 mt-1">Investment to reach 100% SFI</p>
            </button>

            {/* Overstock */}
            <button onClick={() => setActiveKpiModal('overstock')}
              className={cn(
                'rounded-2xl p-5 border shadow-sm hover:shadow-md transition-all cursor-pointer text-left group',
                advancedKPIs.overstockCount === 0 ? 'bg-white border-gray-200 hover:border-amber-200' : 'bg-amber-50 border-amber-200 hover:border-amber-300'
              )}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Layers size={16} className={advancedKPIs.overstockCount === 0 ? 'text-gray-400' : 'text-amber-500'} />
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Overstock</span>
                </div>
                <Info size={13} className="text-gray-300 group-hover:text-amber-400 transition-colors" />
              </div>
              <p className={cn(
                'text-2xl font-bold',
                advancedKPIs.overstockCount === 0 ? 'text-gray-400' : 'text-amber-700'
              )}>
                {advancedKPIs.overstockCount}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {advancedKPIs.overstockCount > 0 ? 'Click to see ranked list →' : 'All products within target'}
              </p>
            </button>
          </div>
        )}

        {/* ── Stock Status Traffic Light ── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Stock Health Overview</h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'In Stock (≥70% target)', count: stockBreakdown.green, color: 'bg-green-500', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
              { label: 'Low Stock (20–70%)', count: stockBreakdown.orange, color: 'bg-orange-400', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
              { label: 'Critical / Out (≤20%)', count: stockBreakdown.red, color: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
            ].map((s) => {
              const total = stockBreakdown.green + stockBreakdown.orange + stockBreakdown.red;
              const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
              return (
                <div key={s.label} className={cn('rounded-xl p-4 border', s.bg, s.border)}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={cn('w-3 h-3 rounded-full', s.color)} />
                    <span className="text-sm font-medium text-gray-700">{s.label}</span>
                  </div>
                  <p className={cn('text-3xl font-bold mb-1', s.text)}>{s.count}</p>
                  <div className="w-full bg-white/50 rounded-full h-1.5 overflow-hidden">
                    <div className={cn('h-full rounded-full', s.color)} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{pct}% of products</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* ── Top 10 Most Ordered Products ── */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Trophy size={18} className="text-yellow-500" />
                <h3 className="font-semibold text-gray-800">Top 10 Most Ordered</h3>
              </div>
              <Link href="/history" className="text-xs text-pink-500 hover:underline">
                View history →
              </Link>
            </div>

            {top10Products.length === 0 ? (
              <div className="text-center py-8">
                <BarChart3 size={32} className="text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No confirmed orders yet.</p>
                <p className="text-xs text-gray-400 mt-1">Confirm orders to see your top products here.</p>
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top10Products.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis
                      type="category"
                      dataKey="descripcion"
                      tick={{ fontSize: 9 }}
                      width={120}
                      tickFormatter={(val) => val.length > 18 ? val.slice(0, 18) + '…' : val}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, fontSize: 11 }}
                      formatter={(v) => [`${v} units`, 'Ordered']}
                    />
                    <Bar dataKey="totalOrdered" radius={[0, 4, 4, 0]}>
                      {top10Products.slice(0, 8).map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {top10Products.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {top10Products.slice(0, 5).map((p, i) => (
                  <div key={p.clave} className="flex items-center gap-3">
                    <span className={cn(
                      'w-5 h-5 flex-shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold text-white',
                      i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-gray-300'
                    )}>
                      {i + 1}
                    </span>
                    <Link
                      href={`/product/${encodeURIComponent(p.clave)}`}
                      className="flex-1 min-w-0 text-xs text-gray-700 truncate hover:text-pink-500"
                    >
                      {p.descripcion}
                    </Link>
                    <span className="text-xs font-bold text-gray-800 flex-shrink-0">{p.totalOrdered} u</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Inventory by Supplier ── */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign size={18} className="text-emerald-500" />
              <h3 className="font-semibold text-gray-800">Inventory Value by Supplier</h3>
            </div>

            {supplierBreakdown.length === 0 ? (
              <div className="text-center py-8">
                <Package size={32} className="text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No inventory data yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {supplierBreakdown.map((s, i) => {
                  const maxVal = supplierBreakdown[0]?.value || 1;
                  const pct = (s.value / maxVal) * 100;
                  return (
                    <div key={s.name}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700 truncate max-w-[60%]">{s.name}</span>
                        <span className="text-gray-500 ml-2">{s.count} SKUs · ${s.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Top Popular Products ── */}
        {topPopular.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Star size={18} className="text-yellow-500 fill-yellow-500" />
                <h3 className="font-semibold text-gray-800">Top Performing Products (by Daily Velocity)</h3>
              </div>
              <Link href="/inventory-hub/behavior" className="text-xs text-pink-500 hover:underline">
                Full analysis →
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {topPopular.map((p, i) => {
                const { icon: MovIcon, color, label } = getMovementIcon(p.overallScore);
                return (
                  <Link
                    key={p.clave}
                    href={`/product/${encodeURIComponent(p.clave)}`}
                    className="group rounded-xl border border-gray-100 p-4 hover:border-pink-200 hover:shadow-md transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg font-black text-gray-200">#{i + 1}</span>
                      <MovIcon size={16} className={color} />
                    </div>
                    <p className="text-xs font-semibold text-gray-800 line-clamp-2 mb-2 group-hover:text-pink-600">
                      {p.descripcion}
                    </p>
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                        p.velocityAge === 'Active/Recent' ? 'bg-emerald-50 text-emerald-600' :
                        p.velocityAge === 'Historical/Stale' ? 'bg-gray-100 text-gray-500' :
                        'bg-blue-50 text-blue-600'
                      )}>
                        {p.velocityAge}
                      </span>
                      <span className="text-sm font-bold text-gray-700">{p.overallScore.toFixed(0)}</span>
                    </div>
                    <p className="text-[10px] text-gray-400">
                      {p.dailyVelocity.toFixed(2)} units/day
                    </p>
                    <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-pink-400 to-pink-600"
                        style={{ width: `${p.overallScore}%` }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Quick Actions ── */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { href: '/inventory-hub', label: 'Import Inventory', sub: 'Upload CSV snapshot', icon: Package, color: 'from-blue-500 to-blue-600 shadow-blue-500/25' },
            { href: '/orders', label: 'Review Orders', sub: `${orderLines.filter(l=>l.selected).length} items pending`, icon: ShoppingCart, color: 'from-pink-500 to-pink-600 shadow-pink-500/25' },
            { href: '/history', label: 'Order History', sub: `${confirmedOrders.length} past orders`, icon: BarChart3, color: 'from-indigo-500 to-indigo-600 shadow-indigo-500/25' },
          ].map((a) => (
            <Link key={a.href} href={a.href} className="group bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-lg transition-all hover:-translate-y-0.5">
              <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3 shadow-lg', a.color)}>
                <a.icon size={20} className="text-white" />
              </div>
              <p className="font-semibold text-gray-800 mb-0.5">{a.label}</p>
              <p className="text-xs text-gray-400">{a.sub}</p>
              <div className="flex items-center gap-1 mt-3 text-xs text-pink-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                Open <ArrowRight size={12} />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── KPI Explanation Modal ── */}
      {activeKpiModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setActiveKpiModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Info size={18} className="text-violet-500" />
                <h3 className="font-bold text-gray-800">
                  {activeKpiModal === 'inventory_value' && 'Inventory Value'}
                  {activeKpiModal === 'pending_order' && 'Pending Order Value'}
                  {activeKpiModal === 'stock_alerts' && 'Stock Alerts'}
                  {activeKpiModal === 'confirmed_orders' && 'Confirmed Orders'}
                  {activeKpiModal === 'sfi' && 'Stock Fulfillment Index (SFI)'}
                  {activeKpiModal === 'oos_rate' && 'Out-of-Stock Rate'}
                  {activeKpiModal === 'capital_gap' && 'Capital Gap'}
                  {activeKpiModal === 'overstock' && 'Overstock Products'}
                </h3>
              </div>
              <button onClick={() => setActiveKpiModal(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* ── Inventory Value ── */}
              {activeKpiModal === 'inventory_value' && (
                <>
                  <ExplainSection title="How it's calculated" color="violet">
                    For every product in your current inventory: <code className="bg-gray-100 px-1 rounded text-xs">CURRENT STOCK × COST PRICE</code>. The results are summed across all products.
                  </ExplainSection>
                  <ExplainSection title="What it means" color="violet">
                    This is the estimated book value of your physical stock at cost — what you would have paid if you bought everything at once at current import prices.
                  </ExplainSection>
                  <ExplainSection title="How reliable is it?" color="amber">
                    <strong>Moderate.</strong> Reliability depends on the accuracy of your imported cost prices. Products with a cost price of $0 are counted as zero value. If some suppliers haven't been imported with cost data, this number will be underestimated.
                  </ExplainSection>
                </>
              )}

              {/* ── Pending Order ── */}
              {activeKpiModal === 'pending_order' && (
                <>
                  <ExplainSection title="How it's calculated" color="pink">
                    <code className="bg-gray-100 px-1 rounded text-xs">Σ (units to order × unit cost)</code> for every product that is currently <strong>selected</strong> in your Total Order page. Deselected products are excluded.
                  </ExplainSection>
                  <ExplainSection title="What it means" color="pink">
                    The total capital you would spend if you confirmed your current order as-is right now. This is a projection, not a committed expense.
                  </ExplainSection>
                  <ExplainSection title="How reliable is it?" color="amber">
                    <strong>High — for selected products.</strong> It reflects the exact formula used in the Total Order page. Unreliable if many products have no target stock set (they won't appear in the order at all), or if cost prices are missing.
                  </ExplainSection>
                </>
              )}

              {/* ── Stock Alerts ── */}
              {activeKpiModal === 'stock_alerts' && (
                <>
                  <ExplainSection title="How it's calculated" color="red">
                    Each product is scored against its target stock:
                    <ul className="mt-1 space-y-0.5 list-disc list-inside text-xs">
                      <li><span className="text-red-600 font-semibold">Red (Out)</span>: stock ≤ 20% of target, or stock = 0</li>
                      <li><span className="text-orange-500 font-semibold">Orange (Low)</span>: stock between 20% and 70% of target</li>
                      <li><span className="text-emerald-600 font-semibold">Green (OK)</span>: stock ≥ 70% of target</li>
                    </ul>
                  </ExplainSection>
                  <ExplainSection title="What it means" color="red">
                    The red number is your critical count — products with zero or near-zero stock that risk being missed by customers. Orange is your early-warning count.
                  </ExplainSection>
                  <ExplainSection title="How reliable is it?" color="amber">
                    <strong>Partial.</strong> Products without a target stock set default to "green" regardless of actual stock. Set targets for all products to get an accurate picture. The Stock Health section below shows the full breakdown.
                  </ExplainSection>
                </>
              )}

              {/* ── Confirmed Orders ── */}
              {activeKpiModal === 'confirmed_orders' && (
                <>
                  <ExplainSection title="How it's calculated" color="emerald">
                    Counts every order you have clicked "Confirm & Place Order" on, stored in your local Order History database.
                  </ExplainSection>
                  <ExplainSection title="What it means" color="emerald">
                    Simply how many purchase orders you have confirmed through this app. Each confirmed order is frozen in history with its exact product list, quantities and total value.
                  </ExplainSection>
                  <ExplainSection title="How reliable is it?" color="emerald">
                    <strong>High.</strong> This is a simple count of persisted records. It does not track external orders placed outside this system.
                  </ExplainSection>
                </>
              )}

              {/* ── SFI ── */}
              {activeKpiModal === 'sfi' && (
                <>
                  <ExplainSection title="How it's calculated" color="indigo">
                    <code className="bg-gray-100 px-1 rounded text-xs">SFI = (Σ current stock) ÷ (Σ target stock) × 100</code><br />
                    Only products with a target stock &gt; 0 are included. Products without a target are excluded from both numerator and denominator.
                  </ExplainSection>
                  <ExplainSection title="What it means" color="indigo">
                    100% = you have exactly as much stock as your targets require across all products.<br />
                    &gt;100% = you are carrying more total stock than needed (potential overstock).<br />
                    &lt;100% = your current stock falls short of your targets.
                  </ExplainSection>
                  <ExplainSection title="How reliable is it?" color="amber">
                    <strong>Only as reliable as your targets.</strong> Currently tracking <strong>{advancedKPIs?.withTargetCount ?? 0}</strong> of <strong>{advancedKPIs?.totalProducts ?? 0}</strong> products. A high SFI can disguise individual product shortages if one supplier is overstocked and another is understocked.
                  </ExplainSection>
                </>
              )}

              {/* ── OOS Rate ── */}
              {activeKpiModal === 'oos_rate' && (
                <>
                  <ExplainSection title="How it's calculated" color="orange">
                    <code className="bg-gray-100 px-1 rounded text-xs">OOS Rate = (products with stock ≤ 0) ÷ (total products) × 100</code><br />
                    Applies to all products in your current inventory, with or without a target.
                  </ExplainSection>
                  <ExplainSection title="What it means" color="orange">
                    The percentage of your catalogue that is completely sold out. Even a small OOS rate (e.g. 5%) means dozens of products your customers cannot buy right now.
                  </ExplainSection>
                  <ExplainSection title="How reliable is it?" color="amber">
                    <strong>High for the snapshot moment.</strong> This reflects your stock at the time of your last import. Physical stock received since the last import will not be reflected until you import again. Import frequently for an accurate picture.
                  </ExplainSection>
                </>
              )}

              {/* ── Capital Gap ── */}
              {activeKpiModal === 'capital_gap' && (
                <>
                  <ExplainSection title="How it's calculated" color="indigo">
                    For each product where <code className="bg-gray-100 px-1 rounded text-xs">current stock &lt; target stock</code>:<br />
                    <code className="bg-gray-100 px-1 rounded text-xs">gap = (target - current) × cost price</code><br />
                    Sum of all gaps across under-target products only.
                  </ExplainSection>
                  <ExplainSection title="What it means" color="indigo">
                    The estimated capital investment needed to bring every under-stocked product back to its target level — in a single order. Think of it as the "maximum order budget" to achieve 100% SFI.
                  </ExplainSection>
                  <ExplainSection title="How reliable is it?" color="amber">
                    <strong>Moderate.</strong> Accurate targets and cost prices are required. Products without a target or cost are excluded. The number also doesn't account for case-size rounding (you may need to buy slightly more than the gap suggests due to pack sizes).
                  </ExplainSection>
                </>
              )}

              {/* ── Overstock detailed list ── */}
              {activeKpiModal === 'overstock' && (
                <>
                  <ExplainSection title="How it's detected" color="amber">
                    A product is flagged as overstock when <code className="bg-gray-100 px-1 rounded text-xs">current stock &gt; target stock</code> (target must be set &gt; 0). Ranked by the number of excess units (highest first).
                  </ExplainSection>
                  <ExplainSection title="Why it matters" color="amber">
                    Overstock ties up capital and shelf space. Review these products to decide whether to increase the target, run a promotion to clear stock, or simply not reorder them in the next cycle.
                  </ExplainSection>

                  {overstockProductsList.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <Layers size={32} className="mx-auto mb-2" />
                      <p className="text-sm">No overstock products found</p>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">
                        <span>Product</span>
                        <span className="flex gap-4">
                          <span className="w-12 text-right">Stock</span>
                          <span className="w-12 text-right">Target</span>
                          <span className="w-16 text-right text-amber-600">Excess</span>
                        </span>
                      </div>
                      <div className="space-y-1 max-h-72 overflow-y-auto">
                        {overstockProductsList.map((p, i) => (
                          <Link
                            key={p.clave}
                            href={`/product/${encodeURIComponent(p.clave)}`}
                            onClick={() => setActiveKpiModal(null)}
                            className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-amber-50 transition-colors group"
                          >
                            <span className="text-xs font-black text-amber-200 w-5 shrink-0">#{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-800 truncate group-hover:text-amber-700">{p.descripcion}</p>
                              <p className="text-[10px] text-gray-400">{p.proveedor}</p>
                            </div>
                            <div className="flex gap-4 text-xs shrink-0">
                              <span className="w-12 text-right text-gray-600">{p.stock}</span>
                              <span className="w-12 text-right text-gray-400">{p.target}</span>
                              <span className="w-16 text-right font-bold text-amber-600">+{p.excess}</span>
                            </div>
                          </Link>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-3 text-center">
                        Total excess capital locked: ${overstockProductsList.reduce((s, p) => s + p.excessValue, 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small helper component for modal explanation sections ─────────────────────
function ExplainSection({
  title, children, color = 'gray',
}: {
  title: string;
  children: React.ReactNode;
  color?: 'violet' | 'pink' | 'red' | 'emerald' | 'indigo' | 'orange' | 'amber' | 'gray';
}) {
  const map: Record<string, string> = {
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
    pink: 'bg-pink-50 border-pink-200 text-pink-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-600',
  };
  return (
    <div className={cn('rounded-xl border p-4', map[color] || map.gray)}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">{title}</p>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
