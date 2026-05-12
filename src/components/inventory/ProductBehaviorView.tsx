'use client';

import React, { useState, useMemo } from 'react';
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
import { TrendingUp, TrendingDown, Minus, Package, Search, Zap, Activity, Ghost } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InventorySnapshot, ProductVelocity } from '@/lib/types/inventory-timeline';
import { format, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';

interface ProductBehaviorViewProps {
  snapshots: InventorySnapshot[];
}

type MovementLabel = 'fast' | 'steady' | 'dead';

interface ProductMovement {
  clave: string;
  descripcion: string;
  proveedor: string;
  currentStock: number;
  previousStock: number;
  sales: number;
  salesVelocity: number;
  label: MovementLabel;
  history: { date: Date; existencia: number }[];
}

export function ProductBehaviorView({ snapshots }: ProductBehaviorViewProps) {
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLabel, setFilterLabel] = useState<MovementLabel | 'all'>('all');

  // Calculate product movements
  const productMovements = useMemo((): ProductMovement[] => {
    if (snapshots.length < 2) return [];

    const latest = snapshots[0];
    const previous = snapshots[1];

    return latest.products.map(product => {
      const prevProduct = previous.products.find(p => p.clave === product.clave);
      const previousStock = prevProduct?.existencia || product.existencia;
      const sales = Math.max(0, previousStock - product.existencia);

      // Calculate velocity based on all snapshots
      const history = snapshots
        .slice(0, 5)
        .map(s => ({
          date: s.date,
          existencia: s.products.find(p => p.clave === product.clave)?.existencia || 0
        }))
        .reverse();

      const daysDiff = history.length >= 2
        ? differenceInDays(history[history.length - 1].date, history[0].date) || 1
        : 1;
      const weeksDiff = daysDiff / 7 || 1;
      const totalChange = history.length >= 2
        ? history[0].existencia - history[history.length - 1].existencia
        : 0;
      const salesVelocity = totalChange > 0 ? totalChange / weeksDiff : 0;

      // Determine label
      let label: MovementLabel = 'steady';
      if (salesVelocity > 5) label = 'fast';
      else if (salesVelocity === 0) label = 'dead';

      return {
        clave: product.clave,
        descripcion: product.descripcion,
        proveedor: product.proveedor,
        currentStock: product.existencia,
        previousStock,
        sales,
        salesVelocity,
        label,
        history
      };
    });
  }, [snapshots]);

  // Filter movements
  const filteredMovements = useMemo(() => {
    return productMovements.filter(m => {
      const matchesSearch =
        m.clave.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.descripcion.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesLabel = filterLabel === 'all' || m.label === filterLabel;
      return matchesSearch && matchesLabel;
    });
  }, [productMovements, searchTerm, filterLabel]);

  // Stats
  const stats = useMemo(() => {
    const fast = productMovements.filter(m => m.label === 'fast').length;
    const steady = productMovements.filter(m => m.label === 'steady').length;
    const dead = productMovements.filter(m => m.label === 'dead').length;
    const totalSales = productMovements.reduce((sum, m) => sum + m.sales, 0);
    return { fast, steady, dead, totalSales };
  }, [productMovements]);

  // Chart data for selected product
  const chartData = useMemo(() => {
    if (!selectedProduct) return [];
    const product = productMovements.find(m => m.clave === selectedProduct);
    if (!product) return [];

    return product.history.map((h, i) => ({
      date: format(h.date, 'dd/MM', { locale: es }),
      fullDate: format(h.date, 'PP', { locale: es }),
      existencia: h.existencia,
      sales: i > 0 ? Math.max(0, product.history[i - 1].existencia - h.existencia) : 0
    }));
  }, [selectedProduct, productMovements]);

  const getLabelBadge = (label: MovementLabel) => {
    switch (label) {
      case 'fast':
        return (
          <span className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
            <Zap size={12} /> Fast Mover
          </span>
        );
      case 'steady':
        return (
          <span className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
            <Activity size={12} /> Steady
          </span>
        );
      case 'dead':
        return (
          <span className="flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
            <Ghost size={12} /> Dead Stock
          </span>
        );
    }
  };

  if (snapshots.length < 2) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="text-center py-16">
          <Package size={64} className="mx-auto text-gray-300 mb-4" />
          <h2 className="text-xl font-semibold text-gray-600 mb-2">Se necesitan más datos</h2>
          <p className="text-gray-500">
            Importa al menos 2 archivos de inventario para analizar el comportamiento de los productos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Product Behavior Analysis</h2>
        <p className="text-gray-500">
          Comparando: {format(snapshots[1].date, 'PP', { locale: es })} → {format(snapshots[0].date, 'PP', { locale: es })}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={16} className="text-emerald-600" />
            <p className="text-xs text-emerald-600 font-medium">Fast Movers</p>
          </div>
          <p className="text-2xl font-bold text-emerald-700">{stats.fast}</p>
        </div>

        <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
          <div className="flex items-center gap-2 mb-1">
            <Activity size={16} className="text-blue-600" />
            <p className="text-xs text-blue-600 font-medium">Steady</p>
          </div>
          <p className="text-2xl font-bold text-blue-700">{stats.steady}</p>
        </div>

        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
          <div className="flex items-center gap-2 mb-1">
            <Ghost size={16} className="text-gray-500" />
            <p className="text-xs text-gray-500 font-medium">Dead Stock</p>
          </div>
          <p className="text-2xl font-bold text-gray-600">{stats.dead}</p>
        </div>

        <div className="bg-purple-50 p-4 rounded-xl border border-purple-200">
          <p className="text-xs text-purple-600 font-medium">Ventas Totales (último periodo)</p>
          <p className="text-2xl font-bold text-purple-700">{stats.totalSales}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar producto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 focus:border-reyna-accent focus:ring-2 focus:ring-reyna-accent/20 outline-none"
          />
        </div>

        <div className="flex gap-2">
          {(['all', 'fast', 'steady', 'dead'] as const).map((label) => (
            <button
              key={label}
              onClick={() => setFilterLabel(label)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-medium transition-all",
                filterLabel === label
                  ? "bg-reyna-accent text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              )}
            >
              {label === 'all' ? 'Todos' : label === 'fast' ? 'Fast' : label === 'steady' ? 'Steady' : 'Dead'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product List */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-700">Movimiento de Productos</h3>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Producto</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Tipo</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Antes → Ahora</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Ventas</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Velocidad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredMovements.slice(0, 100).map((movement) => (
                  <tr
                    key={movement.clave}
                    onClick={() => setSelectedProduct(movement.clave)}
                    className={cn(
                      "cursor-pointer hover:bg-gray-50 transition-colors",
                      selectedProduct === movement.clave && "bg-reyna-pink"
                    )}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-700">{movement.clave}</p>
                      <p className="text-xs text-gray-500 truncate max-w-xs">{movement.descripcion}</p>
                    </td>
                    <td className="px-4 py-3 text-center">{getLabelBadge(movement.label)}</td>
                    <td className="px-4 py-3 text-right text-sm">
                      <span className="text-gray-500">{movement.previousStock}</span>
                      <span className="mx-2 text-gray-300">→</span>
                      <span className={cn(
                        "font-medium",
                        movement.currentStock < movement.previousStock ? "text-red-600" : "text-emerald-600"
                      )}>
                        {movement.currentStock}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {movement.sales > 0 ? (
                        <span className="text-sm font-bold text-emerald-600">+{movement.sales}</span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      {movement.salesVelocity.toFixed(1)}/sem
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Chart Panel */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          {selectedProduct ? (
            <div>
              {(() => {
                const product = productMovements.find(m => m.clave === selectedProduct);
                if (!product) return null;

                return (
                  <>
                    <div className="mb-4">
                      <p className="text-sm text-gray-500">Producto seleccionado</p>
                      <h3 className="font-bold text-gray-800">{product.descripcion}</h3>
                      <p className="text-xs text-gray-400">{product.clave}</p>
                      <div className="mt-2">{getLabelBadge(product.label)}</div>
                    </div>

                    <div className="h-64 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'white',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px'
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="existencia"
                            stroke="#ec4899"
                            strokeWidth={2}
                            dot={{ fill: '#ec4899', r: 3 }}
                            name="Stock"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-gray-500 text-xs">Stock Actual</p>
                        <p className="font-bold text-gray-800">{product.currentStock}</p>
                      </div>
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-gray-500 text-xs">Ventas Periodo</p>
                        <p className="font-bold text-emerald-600">{product.sales}</p>
                      </div>
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-gray-500 text-xs">Velocidad</p>
                        <p className="font-bold text-gray-800">{product.salesVelocity.toFixed(1)}/sem</p>
                      </div>
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-gray-500 text-xs">Proveedor</p>
                        <p className="font-bold text-gray-800 truncate">{product.proveedor}</p>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <TrendingUp size={48} className="text-gray-300 mb-4" />
              <p className="text-gray-500">Selecciona un producto para ver su timeline</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
