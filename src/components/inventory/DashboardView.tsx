'use client';

import React, { useState, useMemo } from 'react';
import { Package, AlertTriangle, CheckCircle2, XCircle, TrendingDown, TrendingUp, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InventorySnapshot, ProductWithOrder } from '@/lib/types/inventory-timeline';
import { processOrders, getStockStatusColor, getStockStatusLabel } from '@/lib/utils/ordering-engine';

interface DashboardViewProps {
  snapshot: InventorySnapshot;
}

export function DashboardView({ snapshot }: DashboardViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'out' | 'low' | 'healthy'>('all');

  // Process products with order calculations
  const productsWithOrders = useMemo(() => {
    return processOrders(snapshot.products);
  }, [snapshot]);

  // Filter products
  const filteredProducts = useMemo(() => {
    return productsWithOrders.filter(product => {
      const matchesSearch =
        product.clave.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.descripcion.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.proveedor.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === 'all' || product.stockStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [productsWithOrders, searchTerm, statusFilter]);

  // Stats
  const stats = useMemo(() => {
    const outOfStock = productsWithOrders.filter(p => p.stockStatus === 'out').length;
    const lowStock = productsWithOrders.filter(p => p.stockStatus === 'low').length;
    const healthyStock = productsWithOrders.filter(p => p.stockStatus === 'healthy').length;
    const totalValue = productsWithOrders.reduce((sum, p) => sum + (p.existencia * p.precioC), 0);
    const neededValue = productsWithOrders.reduce((sum, p) => sum + p.orderValue, 0);

    return { outOfStock, lowStock, healthyStock, totalValue, neededValue };
  }, [productsWithOrders]);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-4 rounded-2xl border-white/50">
          <div className="flex items-center gap-2 mb-2">
            <Package size={16} className="text-blue-500" />
            <span className="text-xs text-gray-500 font-medium">Total Productos</span>
          </div>
          <p className="text-2xl font-bold text-gray-800">{productsWithOrders.length}</p>
        </div>

        <div className="glass-card p-4 rounded-2xl border-white/50">
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={16} className="text-red-500" />
            <span className="text-xs text-gray-500 font-medium">Sin Stock</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{stats.outOfStock}</p>
        </div>

        <div className="glass-card p-4 rounded-2xl border-white/50">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-yellow-500" />
            <span className="text-xs text-gray-500 font-medium">Stock Bajo</span>
          </div>
          <p className="text-2xl font-bold text-yellow-600">{stats.lowStock}</p>
        </div>

        <div className="glass-card p-4 rounded-2xl border-white/50">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={16} className="text-emerald-500" />
            <span className="text-xs text-gray-500 font-medium">Stock OK</span>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{stats.healthyStock}</p>
        </div>
      </div>

      {/* Value Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card p-5 rounded-2xl border-white/50 bg-gradient-to-br from-blue-50 to-blue-100/50">
          <p className="text-sm text-blue-600 font-medium mb-1">Valor Inventario Actual</p>
          <p className="text-3xl font-bold text-blue-700">
            ${stats.totalValue.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        <div className="glass-card p-5 rounded-2xl border-white/50 bg-gradient-to-br from-emerald-50 to-emerald-100/50">
          <p className="text-sm text-emerald-600 font-medium mb-1">Inversión Necesaria</p>
          <p className="text-3xl font-bold text-emerald-700">
            ${stats.neededValue.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por clave, descripción o proveedor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 focus:border-reyna-accent focus:ring-2 focus:ring-reyna-accent/20 outline-none transition-all"
          />
        </div>

        <div className="flex gap-2">
          {(['all', 'out', 'low', 'healthy'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-medium transition-all",
                statusFilter === status
                  ? "bg-reyna-accent text-white shadow-lg shadow-reyna-accent/20"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {status === 'all' ? 'Todos' :
               status === 'out' ? 'Sin Stock' :
               status === 'low' ? 'Stock Bajo' : 'Stock OK'}
            </button>
          ))}
        </div>
      </div>

      {/* Products Table */}
      <div className="glass-card rounded-2xl border-white/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Estado</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Clave</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Descripción</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Proveedor</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Stock</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Objetivo</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Pedido</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.slice(0, 100).map((product) => (
                <tr key={product.clave} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-3 h-3 rounded-full",
                        getStockStatusColor(product.stockStatus)
                      )} />
                      <span className="text-xs font-medium text-gray-600">
                        {getStockStatusLabel(product.stockStatus)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-700">{product.clave}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                    {product.descripcion}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{product.proveedor}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-medium text-gray-700">{product.existencia}</span>
                      {/* Progress Bar */}
                      <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            getStockStatusColor(product.stockStatus)
                          )}
                          style={{ width: `${Math.min(product.stockPercentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">
                    {product.stockObjetivo || '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {product.suggestedOrder > 0 ? (
                      <span className="text-sm font-semibold text-emerald-600">
                        {product.suggestedOrder}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-700">
                    ${product.orderValue.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredProducts.length > 100 && (
          <div className="p-4 text-center text-sm text-gray-500 border-t border-gray-100">
            Mostrando 100 de {filteredProducts.length} productos. Usa los filtros para refinar.
          </div>
        )}

        {filteredProducts.length === 0 && (
          <div className="p-8 text-center">
            <Package size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500">No se encontraron productos con los filtros seleccionados</p>
          </div>
        )}
      </div>
    </div>
  );
}
