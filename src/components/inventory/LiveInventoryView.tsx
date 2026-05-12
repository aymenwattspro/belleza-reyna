'use client';

import React, { useState, useMemo } from 'react';
import { Package, AlertTriangle, CheckCircle2, XCircle, Building2, ShoppingCart, Search, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { InventorySnapshot, ProductWithOrder } from '@/lib/types/inventory-timeline';
import { processOrders, groupBySupplier, getStockStatusColor, getStockStatusLabel } from '@/lib/utils/ordering-engine';

interface LiveInventoryViewProps {
  snapshot: InventorySnapshot;
}

export function LiveInventoryView({ snapshot }: LiveInventoryViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<string | 'all'>('all');
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());

  // Process orders and group by supplier
  const supplierGroups = useMemo(() => {
    const products = processOrders(snapshot.products);
    return groupBySupplier(products);
  }, [snapshot]);

  // Filter suppliers
  const filteredGroups = useMemo(() => {
    if (selectedSupplier === 'all') return supplierGroups;
    return supplierGroups.filter(g => g.supplierName === selectedSupplier);
  }, [supplierGroups, selectedSupplier]);

  // Stats
  const stats = useMemo(() => {
    const allProducts = supplierGroups.flatMap(g => g.products);
    const outOfStock = allProducts.filter(p => p.stockStatus === 'out').length;
    const lowStock = allProducts.filter(p => p.stockStatus === 'low').length;
    const healthyStock = allProducts.filter(p => p.stockStatus === 'healthy').length;
    const totalOrderValue = allProducts.reduce((sum, p) => sum + p.orderValue, 0);
    const itemsToOrder = allProducts.filter(p => p.suggestedOrder > 0).length;

    return { outOfStock, lowStock, healthyStock, totalOrderValue, itemsToOrder, totalProducts: allProducts.length };
  }, [supplierGroups]);

  const toggleSupplier = (supplierName: string) => {
    setExpandedSuppliers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(supplierName)) {
        newSet.delete(supplierName);
      } else {
        newSet.add(supplierName);
      }
      return newSet;
    });
  };

  const exportSupplierOrder = (supplierName: string) => {
    const group = supplierGroups.find(g => g.supplierName === supplierName);
    if (!group) return;

    const itemsToExport = group.products.filter(p => p.suggestedOrder > 0);
    if (itemsToExport.length === 0) {
      toast.error('No hay productos para pedir');
      return;
    }

    const csvContent = [
      'Clave,Descripcion,Stock Actual,Stock Objetivo,Necesidad,Piezas,Pedido Sugerido,Precio Unit,Total',
      ...itemsToExport.map(p =>
        `${p.clave},"${p.descripcion}",${p.existencia},${p.stockObjetivo || 0},${p.needed},${p.piezas || 1},${p.suggestedOrder},${p.precioC},${p.orderValue.toFixed(2)}`
      ),
      `,,,,,,,TOTAL,${group.totalInvestment.toFixed(2)}`
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pedido_${supplierName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    toast.success(`Pedido exportado: ${supplierName}`);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Live Inventory & Orders</h2>
        <p className="text-gray-500">
          Datos del: {new Date(snapshot.date).toLocaleString('es-MX')} • {snapshot.fileName}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs text-gray-500 font-medium">Total Productos</p>
          <p className="text-2xl font-bold text-gray-800">{stats.totalProducts}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2">
            <XCircle size={16} className="text-red-500" />
            <p className="text-xs text-gray-500 font-medium">Sin Stock</p>
          </div>
          <p className="text-2xl font-bold text-red-600">{stats.outOfStock}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-yellow-500" />
            <p className="text-xs text-gray-500 font-medium">Stock Bajo</p>
          </div>
          <p className="text-2xl font-bold text-yellow-600">{stats.lowStock}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-500" />
            <p className="text-xs text-gray-500 font-medium">Stock OK</p>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{stats.healthyStock}</p>
        </div>

        <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-emerald-600" />
            <p className="text-xs text-emerald-600 font-medium">Items a Pedir</p>
          </div>
          <p className="text-2xl font-bold text-emerald-700">{stats.itemsToOrder}</p>
        </div>

        <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 shadow-sm">
          <p className="text-xs text-blue-600 font-medium">Inversión Total</p>
          <p className="text-2xl font-bold text-blue-700">
            ${stats.totalOrderValue.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por clave, descripción..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 focus:border-reyna-accent focus:ring-2 focus:ring-reyna-accent/20 outline-none"
          />
        </div>

        <select
          value={selectedSupplier}
          onChange={(e) => setSelectedSupplier(e.target.value)}
          className="px-4 py-2 rounded-xl border border-gray-200 focus:border-reyna-accent outline-none bg-white"
        >
          <option value="all">Todos los proveedores</option>
          {supplierGroups.map(g => (
            <option key={g.supplierName} value={g.supplierName}>{g.supplierName}</option>
          ))}
        </select>
      </div>

      {/* Supplier Groups */}
      <div className="space-y-4">
        {filteredGroups.map((group) => {
          const isExpanded = expandedSuppliers.has(group.supplierName);
          const filteredProducts = group.products.filter(p =>
            p.clave.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.descripcion.toLowerCase().includes(searchTerm.toLowerCase())
          );

          if (filteredProducts.length === 0) return null;

          return (
            <div key={group.supplierName} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Supplier Header */}
              <div
                className="flex items-center justify-between p-4 bg-gray-50/50 cursor-pointer hover:bg-gray-100/50 transition-colors"
                onClick={() => toggleSupplier(group.supplierName)}
              >
                <div className="flex items-center gap-3">
                  <Building2 size={20} className="text-reyna-accent" />
                  <div>
                    <h3 className="font-semibold text-gray-800">{group.supplierName}</h3>
                    <p className="text-sm text-gray-500">
                      {group.totalItems} items a pedir • {group.products.length} total
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-600">
                      ${group.totalInvestment.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      exportSupplierOrder(group.supplierName);
                    }}
                    disabled={group.totalItems === 0}
                    className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Download size={18} />
                  </button>
                </div>
              </div>

              {/* Products Table */}
              {isExpanded && (
                <div className="border-t border-gray-100">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Estado</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Clave</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Descripción</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Stock</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Objetivo</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Pedido</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredProducts.slice(0, 50).map((product) => (
                        <tr key={product.clave} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={cn("w-2.5 h-2.5 rounded-full", getStockStatusColor(product.stockStatus))} />
                              <span className="text-xs text-gray-600">{getStockStatusLabel(product.stockStatus)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-700">{product.clave}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{product.descripcion}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-sm font-medium">{product.existencia}</span>
                              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full", getStockStatusColor(product.stockStatus))}
                                  style={{ width: `${Math.min(product.stockPercentage, 100)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-gray-600">{product.stockObjetivo || '-'}</td>
                          <td className="px-4 py-3 text-right">
                            {product.suggestedOrder > 0 ? (
                              <span className="text-sm font-bold text-emerald-600">{product.suggestedOrder}</span>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-medium">
                            ${product.orderValue.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
