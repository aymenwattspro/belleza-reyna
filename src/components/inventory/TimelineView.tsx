'use client';

import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { TrendingDown, TrendingUp, Minus, Package, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inventoryDB } from '@/lib/db/inventory-db';
import { calculateVelocity, formatVelocity, predictStockout } from '@/lib/utils/velocity-calculator';
import { ProductVelocity, InventorySnapshot } from '@/lib/types/inventory-timeline';

interface TimelineViewProps {
  snapshots: InventorySnapshot[];
}

export function TimelineView({ snapshots }: TimelineViewProps) {
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [productVelocities, setProductVelocities] = useState<ProductVelocity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadVelocities();
  }, [snapshots]);

  const loadVelocities = async () => {
    if (snapshots.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // Get all unique products from the most recent snapshot
    const mostRecent = snapshots[0];
    const products = mostRecent.products.slice(0, 50); // Limit to first 50 for performance

    const velocities: ProductVelocity[] = [];

    for (const product of products) {
      // Build history for this product
      const history = snapshots
        .map(snapshot => {
          const p = snapshot.products.find(sp => sp.clave === product.clave);
          return p ? { date: snapshot.date, existencia: p.existencia } : null;
        })
        .filter((h): h is { date: Date; existencia: number } => h !== null);

      if (history.length >= 2) {
        const velocity = calculateVelocity(history);
        velocities.push({
          ...velocity,
          clave: product.clave,
          descripcion: product.descripcion
        });
      }
    }

    // Sort by velocity (highest movers first)
    velocities.sort((a, b) => b.weeklyVelocity - a.weeklyVelocity);

    setProductVelocities(velocities);
    setLoading(false);
  };

  // Get chart data for selected product
  const getChartData = (clave: string) => {
    const data = snapshots
      .slice(0, 10) // Last 10 snapshots
      .reverse()
      .map(snapshot => {
        const product = snapshot.products.find(p => p.clave === clave);
        return {
          date: format(snapshot.date, 'dd/MM', { locale: es }),
          fullDate: format(snapshot.date, 'PP', { locale: es }),
          existencia: product?.existencia || 0,
          stockObjetivo: product?.stockObjetivo || 0
        };
      });

    return data;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-reyna-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (snapshots.length < 2) {
    return (
      <div className="text-center py-12">
        <Package size={48} className="mx-auto text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-600">Se necesitan más snapshots</h3>
        <p className="text-gray-500">
          Sube al menos 2 archivos de inventario para ver el timeline y análisis de velocidad.
        </p>
      </div>
    );
  }

  const slowMovers = productVelocities.filter(v => v.isSlowMover);
  const fastMovers = productVelocities.filter(v => !v.isSlowMover && v.weeklyVelocity > 0);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-5 rounded-2xl border-white/50">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
              <Package size={20} />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Productos Analizados</p>
              <h4 className="text-xl font-bold text-reyna-black">{productVelocities.length}</h4>
            </div>
          </div>
        </div>

        <div className="glass-card p-5 rounded-2xl border-white/50">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-yellow-50 text-yellow-600">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Slow Movers</p>
              <h4 className="text-xl font-bold text-reyna-black">{slowMovers.length}</h4>
            </div>
          </div>
        </div>

        <div className="glass-card p-5 rounded-2xl border-white/50">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600">
              <TrendingUp size={20} />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Productos en Movimiento</p>
              <h4 className="text-xl font-bold text-reyna-black">{fastMovers.length}</h4>
            </div>
          </div>
        </div>
      </div>

      {/* Product List with Selection */}
      <div className="glass-card rounded-2xl border-white/50 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-700">Análisis de Velocidad por Producto</h3>
          <p className="text-sm text-gray-500">Selecciona un producto para ver su timeline</p>
        </div>

        <div className="max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Clave</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Descripción</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Velocidad</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Tendencia</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {productVelocities.map((velocity) => (
                <tr
                  key={velocity.clave}
                  onClick={() => setSelectedProduct(velocity.clave)}
                  className={cn(
                    "cursor-pointer hover:bg-gray-50 transition-colors",
                    selectedProduct === velocity.clave && "bg-reyna-pink"
                  )}
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-700">{velocity.clave}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-xs">
                    {velocity.descripcion}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <span className={cn(
                      "font-medium",
                      velocity.weeklyVelocity === 0 ? "text-gray-400" : "text-emerald-600"
                    )}>
                      {formatVelocity(velocity.weeklyVelocity)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {velocity.stockTrend === 'increasing' ? (
                      <TrendingUp size={16} className="mx-auto text-emerald-500" />
                    ) : velocity.stockTrend === 'decreasing' ? (
                      <TrendingDown size={16} className="mx-auto text-red-500" />
                    ) : (
                      <Minus size={16} className="mx-auto text-gray-400" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {velocity.isSlowMover ? (
                      <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">
                        Slow
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">
                        Activo
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Chart for Selected Product */}
      {selectedProduct && (
        <div className="glass-card p-6 rounded-2xl border-white/50">
          <h3 className="font-semibold text-gray-700 mb-4">
            Timeline: {productVelocities.find(v => v.clave === selectedProduct)?.descripcion}
          </h3>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={getChartData(selectedProduct)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  axisLine={{ stroke: '#e5e7eb' }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  axisLine={{ stroke: '#e5e7eb' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                  }}
                  labelFormatter={(label, payload) => {
                    const data = payload?.[0]?.payload;
                    return data?.fullDate || label;
                  }}
                />
                <ReferenceLine
                  y={productVelocities.find(v => v.clave === selectedProduct)?.last5Snapshots[0]?.existencia || 0}
                  stroke="#e5e7eb"
                  strokeDasharray="3 3"
                />
                <Line
                  type="monotone"
                  dataKey="existencia"
                  stroke="#ec4899"
                  strokeWidth={3}
                  dot={{ fill: '#ec4899', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, stroke: '#ec4899', strokeWidth: 2 }}
                  name="Existencia"
                />
                <Line
                  type="monotone"
                  dataKey="stockObjetivo"
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name="Stock Objetivo"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Product Stats */}
          {(() => {
            const velocity = productVelocities.find(v => v.clave === selectedProduct);
            if (!velocity) return null;

            const currentStock = velocity.last5Snapshots[velocity.last5Snapshots.length - 1]?.existencia || 0;
            const stockoutDate = predictStockout(currentStock, velocity.weeklyVelocity);

            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
                <div>
                  <p className="text-xs text-gray-500">Stock Actual</p>
                  <p className="text-lg font-bold text-gray-700">{currentStock}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Velocidad</p>
                  <p className="text-lg font-bold text-gray-700">{formatVelocity(velocity.weeklyVelocity)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Variación</p>
                  <p className={cn(
                    "text-lg font-bold",
                    velocity.stockTrend === 'decreasing' ? "text-red-500" :
                    velocity.stockTrend === 'increasing' ? "text-emerald-500" : "text-gray-500"
                  )}>
                    {velocity.stockTrend === 'decreasing' ? '↓ Bajando' :
                     velocity.stockTrend === 'increasing' ? '↑ Subiendo' : '→ Estable'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Agotamiento Estimado</p>
                  <p className="text-lg font-bold text-gray-700">
                    {stockoutDate ? format(stockoutDate, 'dd/MM/yy', { locale: es }) : 'N/A'}
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
