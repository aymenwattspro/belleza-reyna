'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, Search, Package, TrendingUp, Trash2, ChevronDown, ChevronUp,
  X, RefreshCw, AlertTriangle, FileSpreadsheet, ExternalLink, Clock,
} from 'lucide-react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { format as dateFnsFormat } from 'date-fns';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useInventory } from '@/contexts/InventoryContext';
import { useProductSettings } from '@/contexts/ProductSettingsContext';
import { useOrder } from '@/contexts/OrderContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ImportManager } from '@/components/inventory/ImportManager';

import { getStockStatus, getStatusClasses } from '@/lib/utils/adjust-order';
import { resolveSupplierName } from '@/lib/utils/supplier';
import { InventorySnapshot } from '@/lib/types/inventory-timeline';

export default function InventoryHubPage() {
  const router = useRouter();
  const { snapshots, latestSnapshot, loading, clearAllData } = useInventory();
  const { getAll: getAllSettings } = useProductSettings();
  const { buildOrderFromSnapshot } = useOrder();
  const { t } = useLanguage();

  const [inventorySearch, setInventorySearch] = useState('');
  const [behaviorSearch, setBehaviorSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'green' | 'orange' | 'red' | 'pending'>('all');
  const [expandedSnap, setExpandedSnap] = useState<string | null>(null);

  const settingsMap = useMemo(() => {
    const all = getAllSettings();
    const map = new Map<string, { minStockUnits: number; piezas?: number }>();
    for (const s of all) map.set(s.clave, { minStockUnits: s.minStockUnits, piezas: s.minStockCases });
    return map;
  }, [getAllSettings]);

  useEffect(() => {
    if (latestSnapshot) {
      buildOrderFromSnapshot(latestSnapshot.products, settingsMap, latestSnapshot.id);
    } else if (!loading) {
      buildOrderFromSnapshot([], settingsMap);
    }
  }, [latestSnapshot, settingsMap, loading, buildOrderFromSnapshot]);

  const inventoryProducts = useMemo(() => {
    if (!latestSnapshot) return [];
    const all = getAllSettings();
    const settingsLookup = new Map(all.map((s) => [s.clave, s]));
    return latestSnapshot.products.map((p) => {
      const s = settingsLookup.get(p.clave);
      const effectiveMin = s?.minStockUnits || p.stockObjetivo || 0;
      const stock = Math.max(0, p.existencia);
      const status = getStockStatus(stock, effectiveMin);
      return { ...p, effectiveMin, stock, status };
    });
  }, [latestSnapshot, getAllSettings]);

  const filteredInventory = useMemo(() => {
    let products = inventoryProducts;
    if (stockFilter === 'pending') {
      products = products.filter((p) => (p.stockObjetivo == null || p.stockObjetivo <= 0));
    } else if (stockFilter !== 'all') {
      products = products.filter((p) => p.status === stockFilter);
    }
    if (inventorySearch.trim()) {
      const q = inventorySearch.toLowerCase();
      products = products.filter((p) =>
        p.clave.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q) || (p.proveedor || '').toLowerCase().includes(q)
      );
    }
    return products;
  }, [inventoryProducts, inventorySearch, stockFilter]);

  const stockStats = useMemo(() => ({
    green: inventoryProducts.filter((p) => p.status === 'green').length,
    orange: inventoryProducts.filter((p) => p.status === 'orange').length,
    red: inventoryProducts.filter((p) => p.status === 'red').length,
    pending: inventoryProducts.filter((p) => (p.stockObjetivo == null || p.stockObjetivo <= 0)).length,
    total: inventoryProducts.length,
  }), [inventoryProducts]);

  const exportPendingTargets = useCallback(() => {
    const pending = inventoryProducts.filter((p) => (p.stockObjetivo == null || p.stockObjetivo <= 0));
    const rows = pending.map((p) => ({
      Reference: p.clave, Description: p.descripcion, Supplier: p.proveedor || '',
      'Current Stock': p.stock, 'Cost Price': p.precioC || '', 'Target Stock': '', 'Units per Case': p.piezas || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pending Targets');
    XLSX.writeFile(wb, `pending-targets-${dateFnsFormat(new Date(), 'yyyy-MM-dd')}.xlsx`);
  }, [inventoryProducts]);

  const behaviorProducts = useMemo(() => {
    if (snapshots.length < 2 || !latestSnapshot) return [];
    const claves = new Set<string>();
    for (const s of snapshots) for (const p of s.products) claves.add(p.clave);
    const result: { clave: string; descripcion: string; proveedor: string; latestStock: number; pointCount: number }[] = [];
    for (const clave of claves) {
      const history = snapshots.map((s) => s.products.find((p) => p.clave === clave)).filter(Boolean);
      if (history.length < 2) continue;
      const latest = latestSnapshot.products.find((p) => p.clave === clave);
      if (!latest) continue;
      result.push({ clave, descripcion: latest.descripcion, proveedor: resolveSupplierName(latest.proveedor), latestStock: Math.max(0, latest.existencia), pointCount: history.length });
    }
    return result.sort((a, b) => a.descripcion.localeCompare(b.descripcion));
  }, [snapshots, latestSnapshot]);

  const filteredBehavior = useMemo(() => {
    if (!behaviorSearch.trim()) return behaviorProducts;
    const q = behaviorSearch.toLowerCase();
    return behaviorProducts.filter((p) => p.clave.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q) || p.proveedor.toLowerCase().includes(q));
  }, [behaviorProducts, behaviorSearch]);

  return (
    <ImportManager>
      {(openImport) => (
        <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
          {/* Page Header — stays fixed at the top so the Import button is always
              reachable no matter how much data is on screen. */}
          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900">{t('hub_title')}</h1>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {latestSnapshot
                    ? `${t('hub_last_import')}: ${format(latestSnapshot.date, 'dd MMM yyyy · HH:mm')} · ${latestSnapshot.products.length} ${t('dash_products')}`
                    : t('hub_no_data')}
                </p>
              </div>
              <div className="flex gap-2 items-center shrink-0">
                {snapshots.length > 0 && (
                  <Link href="/imports"
                    className="flex items-center gap-1.5 px-3 py-2 text-gray-500 hover:text-pink-600 hover:bg-pink-50 border border-gray-200 hover:border-pink-200 text-xs font-medium rounded-xl transition-colors">
                    <Clock size={13} /> {t('hub_import_history')}
                    <span className="text-gray-400">({snapshots.length})</span>
                  </Link>
                )}
                {latestSnapshot && (
                  <button
                    onClick={() => {
                      if (window.confirm(`⚠️ ${t('hub_confirm_reset')}`)) {
                        clearAllData().then(() => toast.success(t('hub_data_cleared')));
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 text-gray-400 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 text-xs font-medium rounded-xl transition-colors"
                  >
                    <Trash2 size={13} /> {t('hub_reset_data')}
                  </button>
                )}
                <button onClick={openImport}
                  className="flex items-center gap-2 px-4 py-2 bg-pink-500 text-white text-sm font-semibold rounded-xl hover:bg-pink-600 transition-colors">
                  <Upload size={14} /> {t('hub_import')}
                </button>
              </div>
            </div>
          </div>

          {/* Main split layout — two equal panes that each scroll internally, so
              the page never grows horizontally regardless of data volume. */}
          <div className="flex flex-1 min-h-0">
            {/* LEFT: Product Behavior */}
            <div className="w-1/2 min-w-0 border-r border-gray-200 flex flex-col bg-white">
              <div className="px-4 py-3 border-b border-gray-100 shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                    <TrendingUp size={15} className="text-indigo-500" />
                    {t('hub_product_behavior')}
                    <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-normal">{filteredBehavior.length}</span>
                  </h2>
                  <Link href="/inventory-hub/behavior"
                    className="text-xs text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1 transition-colors">
                    {t('hub_full_analysis')} <ExternalLink size={10} />
                  </Link>
                </div>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={behaviorSearch} onChange={(e) => setBehaviorSearch(e.target.value)}
                    placeholder={t('inv_search')}
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-indigo-400 bg-gray-50" />
                  {behaviorSearch && <button onClick={() => setBehaviorSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={12} className="text-gray-400" /></button>}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-32"><RefreshCw size={18} className="text-gray-400 animate-spin" /></div>
                ) : snapshots.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center p-6">
                    <Upload size={32} className="text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-500">{t('hub_no_imports')}</p>
                    <p className="text-xs text-gray-400 mt-1">{t('hub_upload_first')}</p>
                    <button onClick={openImport}
                      className="mt-4 px-4 py-2 bg-pink-500 text-white text-sm font-medium rounded-xl hover:bg-pink-600 transition-colors">
                      {t('hub_import_first')}
                    </button>
                  </div>
                ) : snapshots.length < 2 ? (
                  <div className="p-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 mb-3">
                      ⚠️ {t('hub_need_2_snapshots')}
                    </div>
                  </div>
                ) : (
                  <div className="p-3 space-y-2">
                    <div className="text-xs text-gray-400 px-1 mb-1">{filteredBehavior.length} {t('hub_data_points')}</div>
                    {filteredBehavior.map((p) => (
                      <BehaviorProductRow key={p.clave} clave={p.clave} descripcion={p.descripcion} proveedor={p.proveedor}
                        latestStock={p.latestStock} pointCount={p.pointCount} snapshots={snapshots}
                        expanded={expandedSnap === p.clave}
                        onExpand={() => setExpandedSnap(expandedSnap === p.clave ? null : p.clave)}
                        onClick={() => router.push(`/product/${encodeURIComponent(p.clave)}`)} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: Current Inventory */}
            <div className="w-1/2 min-w-0 flex flex-col bg-gray-50">
              <div className="px-4 py-3 border-b border-gray-200 bg-white shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                    <Package size={15} className="text-pink-500" />
                    {t('hub_current_inventory')}
                    <span className="text-xs bg-pink-50 text-pink-600 px-2 py-0.5 rounded-full font-normal">{filteredInventory.length}</span>
                  </h2>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  <button onClick={() => setStockFilter('all')}
                    className={cn('text-xs px-2.5 py-1 rounded-full font-medium transition-all',
                      stockFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                    {t('all')} {stockStats.total > 0 && <span className="opacity-70">({stockStats.total})</span>}
                  </button>
                  <button onClick={() => setStockFilter('green')}
                    className={cn('text-xs px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1',
                      stockFilter === 'green' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100')}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" /> {t('hub_in_stock')} ({stockStats.green})
                  </button>
                  <button onClick={() => setStockFilter('orange')}
                    className={cn('text-xs px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1',
                      stockFilter === 'orange' ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100')}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" /> {t('hub_low')} ({stockStats.orange})
                  </button>
                  <button onClick={() => setStockFilter('red')}
                    className={cn('text-xs px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1',
                      stockFilter === 'red' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100')}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" /> {t('hub_out')} ({stockStats.red})
                  </button>
                  {stockStats.pending > 0 && (
                    <button onClick={() => setStockFilter('pending')}
                      className={cn('text-xs px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1',
                        stockFilter === 'pending' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100')}>
                      <AlertTriangle size={9} className="inline-block" /> {t('hub_pending_targets')} ({stockStats.pending})
                    </button>
                  )}
                  {stockFilter === 'pending' && (
                    <button onClick={exportPendingTargets}
                      className="ml-auto text-xs px-2.5 py-1 rounded-full font-medium bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 transition-all flex items-center gap-1">
                      <FileSpreadsheet size={10} className="inline-block" /> {t('hub_export_xlsx')}
                    </button>
                  )}
                </div>

                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)}
                    placeholder={t('inv_search')}
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-pink-400 bg-gray-50" />
                  {inventorySearch && <button onClick={() => setInventorySearch('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={12} className="text-gray-400" /></button>}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-32"><RefreshCw size={18} className="text-gray-400 animate-spin" /></div>
                ) : !latestSnapshot ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center p-6">
                    <Package size={32} className="text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-500">{t('inv_no_inventory')}</p>
                    <p className="text-xs text-gray-400 mt-1">{t('inv_import_snapshot_hint')}</p>
                  </div>
                ) : filteredInventory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 p-4">
                    <Search size={24} className="text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500">{t('inv_no_match')}</p>
                  </div>
                ) : (
                  <table className="w-full text-xs table-fixed">
                    <thead className="bg-white border-b border-gray-200 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">{t('inv_product')}</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wider w-16">{t('inv_stock')}</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wider w-16">{t('inv_target')}</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-500 uppercase tracking-wider w-16">{t('inv_state')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {filteredInventory.map((p) => {
                        const sc = getStatusClasses(p.status);
                        return (
                          <tr key={p.clave} onClick={() => router.push(`/product/${encodeURIComponent(p.clave)}`)}
                            className="hover:bg-gray-50 transition-colors cursor-pointer group">
                            <td className="px-3 py-2">
                              <p className="font-medium text-gray-800 truncate group-hover:text-pink-600 transition-colors">{p.descripcion}</p>
                              <p className="text-[10px] text-gray-400 font-mono truncate">{p.clave} · {resolveSupplierName(p.proveedor)}</p>
                            </td>
                            <td className="px-3 py-2 text-right"><span className={cn('font-bold tabular-nums', sc.text)}>{p.stock}</span></td>
                            <td className="px-3 py-2 text-right"><span className="text-gray-500 tabular-nums">{p.effectiveMin > 0 ? p.effectiveMin : '—'}</span></td>
                            <td className="px-3 py-2 text-center">
                              <span className={cn('inline-flex items-center justify-center w-5 h-5 rounded-full', sc.badge)}>
                                <span className={cn('w-2 h-2 rounded-full', sc.dot)} />
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </ImportManager>
  );
}

function BehaviorProductRow({ clave, descripcion, proveedor, latestStock, pointCount, snapshots, expanded, onExpand, onClick }:
  { clave: string; descripcion: string; proveedor: string; latestStock: number; pointCount: number; snapshots: InventorySnapshot[]; expanded: boolean; onExpand: () => void; onClick: () => void; }) {
  const chartData = useMemo(() => {
    return snapshots.map((s) => {
      const p = s.products.find((pr) => pr.clave === clave);
      return p ? { date: format(s.date, 'dd/MM'), stock: Math.max(0, p.existencia) } : null;
    }).filter(Boolean).sort((a, b) => {
      const [ad, am] = (a!.date).split('/');
      const [bd, bm] = (b!.date).split('/');
      return parseInt(am + ad) - parseInt(bm + bd);
    }) as { date: string; stock: number }[];
  }, [clave, snapshots]);

  const trend = useMemo(() => {
    if (chartData.length < 2) return 'stable';
    const last = chartData[chartData.length - 1].stock;
    const prev = chartData[chartData.length - 2].stock;
    if (last < prev * 0.9) return 'falling';
    if (last > prev * 1.1) return 'rising';
    return 'stable';
  }, [chartData]);

  return (
    <div className="rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer" onClick={onExpand}>
        <div className="flex-1 min-w-0" onClick={(e) => { e.stopPropagation(); onClick(); }}>
          <p className="text-xs font-medium text-gray-800 truncate hover:text-indigo-600 transition-colors">{descripcion}</p>
          <p className="text-[10px] text-gray-400 font-mono truncate">{clave} · {proveedor}</p>
        </div>
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium',
          trend === 'falling' ? 'bg-red-50 text-red-500' : trend === 'rising' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>
          {trend === 'falling' ? '↓' : trend === 'rising' ? '↑' : '→'} {latestStock}
        </span>
        <span className="text-[10px] text-gray-400">{pointCount}pts</span>
        {expanded ? <ChevronUp size={12} className="text-gray-400 shrink-0" /> : <ChevronDown size={12} className="text-gray-400 shrink-0" />}
      </div>
      {expanded && chartData.length >= 2 && (
        <div className="h-28 px-2 pb-2 bg-gray-50">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ fontSize: 10, borderRadius: 6 }} />
              <Line type="monotone" dataKey="stock" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
