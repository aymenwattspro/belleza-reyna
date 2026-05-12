'use client';

import React, { useState, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Search, TrendingUp, TrendingDown, Minus,
  RefreshCw, X, DollarSign, Users, Box,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInventory, InventoryProvider } from '@/contexts/InventoryContext';
import { getStockStatus, getStatusClasses } from '@/lib/utils/adjust-order';

function SupplierDetailInner({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const supplierName = decodeURIComponent(resolvedParams.id);

  const { latestSnapshot, popularityScores, snapshots, loading } = useInventory();
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'green' | 'orange' | 'red'>('all');

  // Products from this supplier
  const supplierProducts = useMemo(() => {
    if (!latestSnapshot) return [];
    return latestSnapshot.products.filter(
      p => (p.proveedor || 'General') === supplierName
    );
  }, [latestSnapshot, supplierName]);

  // Products enriched with stock status
  const productsWithStatus = useMemo(() => {
    return supplierProducts.map(p => {
      const stock = Math.max(0, p.existencia);
      const effectiveMin = p.stockObjetivo || 0;
      const status = getStockStatus(stock, effectiveMin);
      return { ...p, stock, effectiveMin, status };
    });
  }, [supplierProducts]);

  // Apply filters + search
  const filtered = useMemo(() => {
    let products = productsWithStatus;
    if (stockFilter !== 'all') {
      products = products.filter(p => p.status === stockFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      products = products.filter(p =>
        p.clave.toLowerCase().includes(q) ||
        p.descripcion.toLowerCase().includes(q)
      );
    }
    return products;
  }, [productsWithStatus, stockFilter, search]);

  // Summary stats
  const stats = useMemo(() => {
    const total = productsWithStatus.length;
    const green = productsWithStatus.filter(p => p.status === 'green').length;
    const orange = productsWithStatus.filter(p => p.status === 'orange').length;
    const red = productsWithStatus.filter(p => p.status === 'red').length;
    const totalValue = productsWithStatus.reduce((a, p) => a + p.stock * (p.precioC || 0), 0);
    const totalUnits = productsWithStatus.reduce((a, p) => a + p.stock, 0);
    return { total, green, orange, red, totalValue, totalUnits };
  }, [productsWithStatus]);

  // Supplier behavior analytics
  const supplierScores = useMemo(
    () => popularityScores.filter(s => s.proveedor === supplierName),
    [popularityScores, supplierName]
  );
  const hasBehavior = snapshots.length >= 2 && supplierScores.length > 0;
  const avgBehaviorScore = supplierScores.length > 0
    ? supplierScores.reduce((a, b) => a + b.overallScore, 0) / supplierScores.length
    : 0;
  const risingCount = supplierScores.filter(s => s.trend === 'rising').length;
  const fallingCount = supplierScores.filter(s => s.trend === 'falling').length;
  const overallTrend: 'rising' | 'stable' | 'falling' =
    risingCount > fallingCount ? 'rising' : fallingCount > risingCount ? 'falling' : 'stable';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={24} className="animate-spin text-pink-400" />
      </div>
    );
  }

  if (!latestSnapshot || supplierProducts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <button
          onClick={() => router.push('/suppliers')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-pink-600 mb-6 transition-colors"
        >
          <ArrowLeft size={16} /> Back to Suppliers
        </button>
        <div className="text-center py-16">
          <Box size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-500 mb-2">
            No products found for &ldquo;{supplierName}&rdquo;
          </h3>
          <p className="text-sm text-gray-400">This supplier has no products in the current inventory.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <button
          onClick={() => router.push('/suppliers')}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-pink-600 mb-2 transition-colors"
        >
          <ArrowLeft size={12} /> Back to Suppliers
        </button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center shadow-sm shadow-pink-500/25">
              <Users size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{supplierName}</h1>
              <p className="text-xs text-gray-500">{stats.total} products in inventory</p>
            </div>
          </div>

          {hasBehavior && (
            <div className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-medium',
              overallTrend === 'rising' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                overallTrend === 'falling' ? 'bg-red-50 border-red-200 text-red-600' :
                  'bg-gray-50 border-gray-200 text-gray-600'
            )}>
              {overallTrend === 'rising' ? <TrendingUp size={14} /> :
                overallTrend === 'falling' ? <TrendingDown size={14} /> :
                  <Minus size={14} />}
              <span>Overall: {overallTrend}</span>
              <span className="text-xs opacity-60">({avgBehaviorScore.toFixed(0)} score)</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Products</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Total Units</p>
            <p className="text-2xl font-bold text-gray-900">{stats.totalUnits.toLocaleString()}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
              <DollarSign size={10} /> Stock Value
            </p>
            <p className="text-2xl font-bold text-gray-900">
              ${stats.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="bg-red-50 rounded-xl p-4">
            <p className="text-xs text-red-400 mb-1">Out of Stock</p>
            <p className="text-2xl font-bold text-red-600">{stats.red}</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Filters + Search */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Stock status filter pills */}
          {(
            [
              { key: 'all' as const, label: `All (${stats.total})` },
              { key: 'green' as const, label: `In Stock (${stats.green})` },
              { key: 'orange' as const, label: `Low (${stats.orange})` },
              { key: 'red' as const, label: `Out (${stats.red})` },
            ]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStockFilter(key)}
              className={cn(
                'text-xs px-3 py-1.5 rounded-full font-medium transition-all',
                stockFilter === key
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              )}
            >
              {label}
            </button>
          ))}

          {/* Search input */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by ref or name..."
              className="w-full pl-8 pr-8 py-1.5 rounded-xl border border-gray-200 text-xs outline-none focus:border-pink-400 bg-white"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X size={12} className="text-gray-400" />
              </button>
            )}
          </div>
        </div>

        {/* Product table */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">
                  Stock
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">
                  Target
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
                  Cost
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-16">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(p => {
                const sc = getStatusClasses(p.status);
                return (
                  <tr
                    key={p.clave}
                    onClick={() => router.push(`/product/${encodeURIComponent(p.clave)}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800 truncate max-w-xs group-hover:text-pink-600 transition-colors">
                        {p.descripcion}
                      </p>
                      <p className="text-xs text-gray-400 font-mono">{p.clave}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn('font-bold tabular-nums', sc.text)}>{p.stock}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 tabular-nums">
                      {p.effectiveMin > 0 ? p.effectiveMin : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 tabular-nums">
                      {p.precioC > 0 ? `$${p.precioC.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('inline-flex items-center justify-center w-5 h-5 rounded-full', sc.badge)}>
                        <span className={cn('w-2 h-2 rounded-full', sc.dot)} />
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-gray-400">
                    No products match your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <InventoryProvider>
      <SupplierDetailInner params={params} />
    </InventoryProvider>
  );
}
