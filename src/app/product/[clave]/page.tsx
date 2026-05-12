'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Package, TrendingUp, TrendingDown, Minus, Save,
  CalendarDays, DollarSign, ShoppingCart, Star, Activity,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useInventory } from '@/contexts/InventoryContext';
import { useProductSettings } from '@/contexts/ProductSettingsContext';
import { adjustOrder, getStockStatus, getStatusClasses } from '@/lib/utils/adjust-order';
import { format } from 'date-fns';

function ProductDetailInner() {
  const params = useParams();
  const router = useRouter();
  const clave = decodeURIComponent(params.clave as string);

  const { latestSnapshot, snapshots, getProductHistory, getPopularityScore } = useInventory();
  const { get: getSettings, save: saveSettings } = useProductSettings();

  const product = useMemo(
    () => latestSnapshot?.products.find((p) => p.clave === clave) || null,
    [latestSnapshot, clave]
  );

  const [minStockUnits, setMinStockUnits] = useState(0);
  const [minStockCases, setMinStockCases] = useState(0);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const s = getSettings(clave);
    if (s) {
      setMinStockUnits(s.minStockUnits);
      setMinStockCases(s.minStockCases);
      setNotes(s.notes || '');
    } else if (product?.stockObjetivo) {
      setMinStockUnits(product.stockObjetivo);
    }
  }, [clave, getSettings, product]);

  const history = useMemo(() => getProductHistory(clave), [clave, getProductHistory]);
  const popularityScore = useMemo(() => getPopularityScore(clave), [clave, getPopularityScore]);

  const currentStock = Math.max(0, product?.existencia ?? 0);
  const effectiveMinStock = minStockUnits || product?.stockObjetivo || 0;
  const piezas = product?.piezas || 1;
  const costPrice = product?.precioC || 0;
  const salePrice = product?.precioV || 0;
  const profitMargin =
    costPrice > 0 && salePrice > 0
      ? (((salePrice - costPrice) / salePrice) * 100).toFixed(1)
      : null;

  const baseOrder = Math.max(0, effectiveMinStock - currentStock);
  const unitsToOrder = adjustOrder(baseOrder, piezas);
  const orderValue = unitsToOrder * costPrice;

  const stockStatus = getStockStatus(currentStock, effectiveMinStock);
  const statusClasses = getStatusClasses(stockStatus);

  const lastImportDate = latestSnapshot?.date || null;

  const chartData = useMemo(
    () =>
      history.map((h, i) => ({
        date: format(h.date, 'dd/MM'),
        stock: h.existencia,
        sales: i > 0 ? Math.max(0, history[i - 1].existencia - h.existencia) : 0,
      })),
    [history]
  );

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await saveSettings({ clave, minStockUnits, minStockCases, notes, updatedAt: new Date().toISOString() });
      toast.success('Settings saved');
    } catch {
      toast.error('Error saving settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (!product && latestSnapshot) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <Package size={48} className="text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-600 mb-2">Product not found</h2>
        <p className="text-gray-400 mb-6">
          Reference: <code className="bg-gray-100 px-2 py-0.5 rounded">{clave}</code>
        </p>
        <Link href="/inventory-hub" className="px-4 py-2 bg-pink-500 text-white rounded-xl text-sm font-medium hover:bg-pink-600 transition-colors">
          Back to Inventory
        </Link>
      </div>
    );
  }

  if (!latestSnapshot) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <Package size={48} className="text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-600 mb-2">No inventory data</h2>
        <Link href="/inventory-hub" className="px-4 py-2 bg-pink-500 text-white rounded-xl text-sm font-medium hover:bg-pink-600 transition-colors">
          Import inventory →
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="font-bold text-gray-900 text-lg line-clamp-1">{product?.descripcion || clave}</h1>
              <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', statusClasses.badge)}>
                ● {statusClasses.label}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{clave} · {product?.proveedor || 'Unknown'}</p>
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-pink-500 text-white text-sm font-medium rounded-xl hover:bg-pink-600 disabled:opacity-50 transition-colors"
          >
            <Save size={14} />
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 mb-3">
              <CalendarDays size={16} />
              <span className="text-xs font-medium uppercase tracking-wide">Last Import</span>
            </div>
            <p className="text-lg font-bold text-gray-800">
              {lastImportDate ? format(lastImportDate, 'dd MMM yyyy') : '—'}
            </p>
            <p className="text-xs text-gray-400 mt-1">{lastImportDate ? format(lastImportDate, 'HH:mm') : ''}</p>
          </div>

          <div className={cn('bg-white rounded-2xl p-5 border shadow-sm', stockStatus === 'red' ? 'border-red-200' : stockStatus === 'orange' ? 'border-orange-200' : 'border-gray-200')}>
            <div className="flex items-center gap-2 text-gray-500 mb-3">
              <Package size={16} />
              <span className="text-xs font-medium uppercase tracking-wide">Current Stock</span>
            </div>
            <p className={cn('text-3xl font-bold', stockStatus === 'red' ? 'text-red-600' : stockStatus === 'orange' ? 'text-orange-500' : 'text-emerald-600')}>
              {currentStock}
            </p>
            <p className="text-xs text-gray-400 mt-1">units · target: {effectiveMinStock || '—'}</p>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 mb-3">
              <DollarSign size={16} />
              <span className="text-xs font-medium uppercase tracking-wide">Profit Margin</span>
            </div>
            <p className="text-3xl font-bold text-gray-800">{profitMargin !== null ? `${profitMargin}%` : '—'}</p>
            <p className="text-xs text-gray-400 mt-1">Cost ${costPrice.toFixed(2)} · Sale ${salePrice > 0 ? salePrice.toFixed(2) : '—'}</p>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 mb-3">
              <Star size={16} />
              <span className="text-xs font-medium uppercase tracking-wide">Popularity</span>
            </div>
            {popularityScore ? (
              <>
                <p className="text-3xl font-bold text-gray-800">{popularityScore.overallScore.toFixed(0)}</p>
                <div className="flex items-center gap-1 mt-1">
                  {popularityScore.trend === 'rising' && <TrendingUp size={12} className="text-emerald-500" />}
                  {popularityScore.trend === 'falling' && <TrendingDown size={12} className="text-red-500" />}
                  {popularityScore.trend === 'stable' && <Minus size={12} className="text-gray-400" />}
                  <span className="text-xs text-gray-400 capitalize">{popularityScore.trend}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400">Need 2+ imports</p>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left: Chart + Order */}
          <div className="lg:col-span-2 space-y-5">
            {/* Stock Evolution Chart */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-800">Stock Evolution</h3>
                  <p className="text-xs text-gray-500">{history.length} data points · {snapshots.length} imports</p>
                </div>
                {history.length < 2 && (
                  <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">⚠️ Need 2+ imports</span>
                )}
              </div>
              {history.length >= 2 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
                      {effectiveMinStock > 0 && (
                        <ReferenceLine y={effectiveMinStock} stroke="#f97316" strokeDasharray="4 2"
                          label={{ value: 'Min', position: 'right', fontSize: 10 }} />
                      )}
                      <Line type="monotone" dataKey="stock" stroke="#6366f1" strokeWidth={2.5}
                        dot={{ r: 4, fill: '#6366f1' }} name="Stock" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-56 flex items-center justify-center">
                  <div className="text-center">
                    <Activity size={32} className="text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">Import more snapshots to see the evolution trend</p>
                  </div>
                </div>
              )}
            </div>

            {/* Order Calculation */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <h3 className="font-semibold text-gray-800 mb-4">Order Calculation</h3>
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Current Stock', value: currentStock, color: false },
                  { label: 'Target Stock', value: effectiveMinStock || '—', color: false },
                  { label: 'Units/Case', value: piezas, color: false },
                  { label: 'Suggest Order', value: unitsToOrder, color: unitsToOrder > 0 },
                ].map((item) => (
                  <div key={item.label} className={cn('rounded-xl p-3 text-center', item.color ? 'bg-pink-50 border border-pink-200' : 'bg-gray-50')}>
                    <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                    <p className={cn('text-xl font-bold', item.color ? 'text-pink-600' : 'text-gray-800')}>{item.value}</p>
                  </div>
                ))}
              </div>
              {unitsToOrder > 0 && (
                <div className="flex items-center justify-between bg-gradient-to-r from-pink-50 to-pink-100/50 rounded-xl p-4 border border-pink-200">
                  <div className="flex items-center gap-2">
                    <ShoppingCart size={16} className="text-pink-600" />
                    <span className="text-sm font-medium text-pink-700">Recommended order value</span>
                  </div>
                  <span className="text-lg font-bold text-pink-700">${orderValue.toFixed(2)}</span>
                </div>
              )}
              {baseOrder > 0 && unitsToOrder === 0 && (
                <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 text-sm text-amber-700">
                  ⚠️ Base order ({baseOrder} units) is less than 50% of one case ({piezas} units). Not ordering per rounding rule.
                </div>
              )}
            </div>
          </div>

          {/* Right: Settings + Info */}
          <div className="space-y-5">
            {/* Settings */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <h3 className="font-semibold text-gray-800 mb-4">Minimum Stock Settings</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Stock (Units)</label>
                  <input type="number" min={0} value={minStockUnits} onChange={(e) => setMinStockUnits(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400" placeholder="e.g. 24" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Stock (Cases/Lots)</label>
                  <input type="number" min={0} value={minStockCases} onChange={(e) => setMinStockCases(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400" placeholder="e.g. 2" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400 resize-none"
                    placeholder="Internal notes..." />
                </div>
              </div>
            </div>

            {/* Product Info */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <h3 className="font-semibold text-gray-800 mb-4">Product Info</h3>
              <div className="space-y-1.5 text-sm">
                {[
                  { label: 'Reference', value: clave, mono: true },
                  { label: 'Supplier', value: product?.proveedor || '—' },
                  { label: 'Units/Case', value: `${piezas} pcs` },
                  { label: 'Cost Price', value: `$${costPrice.toFixed(2)}` },
                  { label: 'Sale Price', value: salePrice > 0 ? `$${salePrice.toFixed(2)}` : '—' },
                  { label: 'Data Points', value: `${history.length} imports` },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-gray-50">
                    <span className="text-gray-500">{row.label}</span>
                    <span className={cn('font-medium text-gray-800', row.mono && 'font-mono text-xs')}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Popularity */}
            {popularityScore && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                <h3 className="font-semibold text-gray-800 mb-4">Performance Metrics</h3>
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500">Overall Score</span>
                    <span className="font-bold">{popularityScore.overallScore.toFixed(0)}/100</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full"
                      style={{ width: `${popularityScore.overallScore}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: 'Total Sales', value: popularityScore.totalSales },
                    { label: 'Velocity', value: `${popularityScore.salesVelocity.toFixed(1)}/wk` },
                    { label: 'Consistency', value: `${popularityScore.consistencyScore.toFixed(0)}%` },
                    {
                      label: 'Trend',
                      value: popularityScore.trend === 'rising' ? '↑ Rising' : popularityScore.trend === 'falling' ? '↓ Falling' : '→ Stable',
                      colored: popularityScore.trend === 'rising' ? 'text-emerald-600' : popularityScore.trend === 'falling' ? 'text-red-500' : 'text-gray-600'
                    },
                  ].map((m) => (
                    <div key={m.label} className="bg-gray-50 rounded-lg p-2">
                      <p className="text-gray-500">{m.label}</p>
                      <p className={cn('font-bold text-gray-800', m.colored)}>{m.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProductDetailPage() {
  return <ProductDetailInner />;
}
