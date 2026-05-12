'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Package, TrendingUp, TrendingDown, Minus,
  Search, DollarSign, RefreshCw, AlertCircle, Box, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInventory, InventoryProvider } from '@/contexts/InventoryContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';

interface SupplierStat {
  name: string;
  productCount: number;
  totalStockUnits: number;
  totalStockValue: number;
  outOfStockCount: number;
  lowStockCount: number;
}

function SuppliersPageInner() {
  const router = useRouter();
  const { latestSnapshot, popularityScores, snapshots, loading } = useInventory();
  const [search, setSearch] = useState('');

  // Derive suppliers from live inventory data
  const suppliers = useMemo((): SupplierStat[] => {
    if (!latestSnapshot) return [];

    const supplierMap = new Map<string, SupplierStat>();

    for (const product of latestSnapshot.products) {
      const name = product.proveedor || 'General';
      const entry = supplierMap.get(name) ?? {
        name,
        productCount: 0,
        totalStockUnits: 0,
        totalStockValue: 0,
        outOfStockCount: 0,
        lowStockCount: 0,
      };

      const stock = Math.max(0, product.existencia);
      entry.productCount++;
      entry.totalStockUnits += stock;
      entry.totalStockValue += stock * (product.precioC || 0);
      if (stock === 0) {
        entry.outOfStockCount++;
      } else if (product.stockObjetivo && stock < product.stockObjetivo) {
        entry.lowStockCount++;
      }

      supplierMap.set(name, entry);
    }

    return Array.from(supplierMap.values()).sort((a, b) => b.productCount - a.productCount);
  }, [latestSnapshot]);

  // Behavior stats per supplier (requires ≥2 snapshots)
  const supplierBehavior = useMemo(() => {
    const map = new Map<string, {
      avgScore: number;
      trend: 'rising' | 'stable' | 'falling';
      rising: number;
      falling: number;
    }>();
    for (const sup of suppliers) {
      const scores = popularityScores.filter(s => s.proveedor === sup.name);
      if (scores.length === 0) continue;
      const avgScore = scores.reduce((a, b) => a + b.overallScore, 0) / scores.length;
      const rising = scores.filter(s => s.trend === 'rising').length;
      const falling = scores.filter(s => s.trend === 'falling').length;
      const trend: 'rising' | 'stable' | 'falling' =
        rising > falling ? 'rising' : falling > rising ? 'falling' : 'stable';
      map.set(sup.name, { avgScore, trend, rising, falling });
    }
    return map;
  }, [suppliers, popularityScores]);

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  // Global stats
  const totalProducts = suppliers.reduce((a, b) => a + b.productCount, 0);
  const totalValue = suppliers.reduce((a, b) => a + b.totalStockValue, 0);
  const totalOutOfStock = suppliers.reduce((a, b) => a + b.outOfStockCount, 0);
  const hasBehavior = snapshots.length >= 2;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={24} className="animate-spin text-pink-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <h1 className="text-xl font-bold text-gray-900">Suppliers</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {latestSnapshot
            ? `Last import: ${format(latestSnapshot.date, 'dd MMM yyyy')} · ${suppliers.length} suppliers · ${totalProducts} products`
            : 'No inventory data yet — import a file to see suppliers'}
        </p>
      </div>

      {/* Global stats */}
      {latestSnapshot && (
        <div className="bg-white border-b border-gray-100 px-6 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Suppliers" value={suppliers.length} sub="" color="pink" icon={Users} />
            <StatCard label="Total Products" value={totalProducts} sub="" color="indigo" icon={Package} />
            <StatCard
              label="Stock Value"
              value={`$${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
              sub=""
              color="emerald"
              icon={DollarSign}
            />
            <StatCard label="Out of Stock" value={totalOutOfStock} sub="across all suppliers" color="red" icon={AlertCircle} />
          </div>
        </div>
      )}

      <div className="p-6">
        {/* Search */}
        <div className="relative mb-5">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search supplier..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-pink-400 bg-white max-w-sm"
          />
        </div>

        {/* No data state */}
        {!latestSnapshot && (
          <div className="text-center py-20">
            <Box size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-500 mb-2">No inventory data</h3>
            <p className="text-sm text-gray-400 mb-4">Import an inventory file to see your suppliers here.</p>
            <button
              onClick={() => router.push('/inventory-hub')}
              className="px-4 py-2 bg-pink-500 text-white rounded-xl text-sm font-medium hover:bg-pink-600 transition-colors"
            >
              Go to Inventory Hub
            </button>
          </div>
        )}

        {/* Supplier cards */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(supplier => {
              const behavior = supplierBehavior.get(supplier.name);

              return (
                <div
                  key={supplier.name}
                  onClick={() => router.push(`/suppliers/${encodeURIComponent(supplier.name)}`)}
                  className="bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md hover:border-pink-200 cursor-pointer transition-all group"
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center shadow-sm shadow-pink-500/25 shrink-0">
                        <Users size={18} className="text-white" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 group-hover:text-pink-600 transition-colors">
                          {supplier.name}
                        </h3>
                        <p className="text-xs text-gray-400">{supplier.productCount} products</p>
                      </div>
                    </div>

                    {hasBehavior && behavior && (
                      <div className={cn(
                        'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full shrink-0',
                        behavior.trend === 'rising' ? 'bg-emerald-50 text-emerald-600' :
                          behavior.trend === 'falling' ? 'bg-red-50 text-red-500' :
                            'bg-gray-100 text-gray-500'
                      )}>
                        {behavior.trend === 'rising'
                          ? <TrendingUp size={11} />
                          : behavior.trend === 'falling'
                            ? <TrendingDown size={11} />
                            : <Minus size={11} />}
                        {behavior.trend}
                      </div>
                    )}
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Stock Units</p>
                      <p className="font-bold text-gray-900">{supplier.totalStockUnits.toLocaleString()}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Stock Value</p>
                      <p className="font-bold text-gray-900">
                        ${supplier.totalStockValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="bg-red-50 rounded-xl p-3">
                      <p className="text-[10px] text-red-400 uppercase tracking-wide mb-1">Out of Stock</p>
                      <p className="font-bold text-red-600">{supplier.outOfStockCount}</p>
                    </div>
                    <div className="bg-orange-50 rounded-xl p-3">
                      <p className="text-[10px] text-orange-400 uppercase tracking-wide mb-1">Low Stock</p>
                      <p className="font-bold text-orange-600">{supplier.lowStockCount}</p>
                    </div>
                  </div>

                  {/* Behavior score bar */}
                  {hasBehavior && behavior && (
                    <div className="pt-3 border-t border-gray-100">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide">Avg Behavior Score</span>
                        <span className="text-xs font-bold text-gray-700">{behavior.avgScore.toFixed(0)}/100</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-pink-400 to-pink-600 rounded-full"
                          style={{ width: `${Math.min(100, behavior.avgScore)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronRight size={16} className="text-pink-400" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat card component ─────────────────────────────────────────────────────
function StatCard({
  label, value, sub, color, icon: Icon,
}: {
  label: string;
  value: string | number;
  sub: string;
  color: 'pink' | 'indigo' | 'emerald' | 'red';
  icon: React.ElementType;
}) {
  const colors = {
    pink: { bg: 'bg-pink-50', border: 'border-pink-100', iconBg: 'bg-pink-100', text: 'text-pink-600' },
    indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100', iconBg: 'bg-indigo-100', text: 'text-indigo-600' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', iconBg: 'bg-emerald-100', text: 'text-emerald-600' },
    red: { bg: 'bg-red-50', border: 'border-red-100', iconBg: 'bg-red-100', text: 'text-red-600' },
  };
  const c = colors[color];

  return (
    <div className={cn('rounded-xl p-4 border flex items-center gap-3', c.bg, c.border)}>
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', c.iconBg)}>
        <Icon size={16} className={c.text} />
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className={cn('text-xl font-bold leading-tight', c.text)}>{value}</p>
        {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

export default function SuppliersPage() {
  return (
    <InventoryProvider>
      <SuppliersPageInner />
    </InventoryProvider>
  );
}
