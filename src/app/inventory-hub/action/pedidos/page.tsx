'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, Download, Search, Package } from 'lucide-react';
import { useInventory } from '@/contexts/InventoryContext';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function PedidosPage() {
  const { latestSnapshot } = useInventory();
  const [searchTerm, setSearchTerm] = useState('');

  if (!latestSnapshot) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Package size={64} className="mx-auto text-gray-300 mb-4" />
          <h2 className="text-xl font-semibold text-gray-600 mb-2">No hay datos</h2>
          <p className="text-gray-500">Importa datos desde Product Behavior</p>
        </div>
      </div>
    );
  }

  // Calculate products that need to be ordered
  const productsToOrder = latestSnapshot.products
    .filter(product => {
      // Only show products that need to be ordered
      const target = product.stockObjetivo || 0;
      const current = product.existencia || 0;
      const needsOrder = target > current;
      
      return needsOrder;
    })
    .map(product => {
      // Calculate order quantity
      const target = product.stockObjetivo || 0;
      const current = product.existencia || 0;
      const missing = target - current;
      const piezas = product.piezas || 1;
      const toOrder = Math.ceil(missing / piezas) * piezas;
      
      return {
        ...product,
        missing,
        toOrder,
        orderValue: toOrder * (product.precioC || 0)
      };
    });

  // Group products to order by supplier
  const supplierGroups = productsToOrder.reduce((acc, product) => {
    const supplier = product.proveedor || 'General';
    if (!acc[supplier]) {
      acc[supplier] = [];
    }
    acc[supplier].push(product);
    return acc;
  }, {} as Record<string, typeof productsToOrder>);

  // Filter suppliers
  const filteredSuppliers = Object.entries(supplierGroups).filter(([name]) =>
    name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const exportSupplier = (supplierName: string, products: typeof productsToOrder) => {
    const csvContent = [
      'Clave,Descripcion,Existencia Actual,Stock Objetivo,Faltante,A Pedir,Precio Unit,Valor Total',
      ...products.map(p =>
        `${p.clave},"${p.descripcion}",${p.existencia},${p.stockObjetivo || 0},${p.missing},${p.toOrder},${p.precioC || 0},${p.orderValue.toFixed(2)}`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pedido_${supplierName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/inventory-hub/action" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft size={20} className="text-gray-600" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-800">Pedidos por Proveedor</h1>
              <p className="text-sm text-gray-500">
                {Object.keys(supplierGroups).length} proveedores • {latestSnapshot.products.length} productos
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar proveedor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        {/* Supplier Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSuppliers.map(([supplierName, products]) => {
            // Calculate stats for products that need ordering
            const productsNeedingOrder = products.filter(p => {
              const target = p.stockObjetivo || 0;
              const current = p.existencia || 0;
              return target > current;
            });

            const totalOrderValue = productsNeedingOrder.reduce((sum, p) => {
              const target = p.stockObjetivo || 0;
              const current = p.existencia || 0;
              const missing = target - current;
              const piezas = p.piezas || 1;
              const toOrder = Math.ceil(missing / piezas) * piezas;
              return sum + (toOrder * (p.precioC || 0));
            }, 0);

            const criticalItems = productsNeedingOrder.filter(p => {
              const current = p.existencia || 0;
              return current === 0;
            }).length;

            return (
              <div key={supplierName} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Header */}
                <div className="p-6 bg-gradient-to-r from-blue-50 to-blue-100 border-b border-blue-200">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-600 rounded-lg">
                        <Building2 size={20} className="text-white" />
                      </div>
                      <div>
                        <h3 className="font-bold text-blue-900">{supplierName}</h3>
                        <p className="text-sm text-blue-700">
                          {productsNeedingOrder.length} productos para ordenar
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => exportSupplier(supplierName, productsNeedingOrder)}
                      className="p-2 text-blue-600 hover:bg-blue-200 rounded-lg transition-colors"
                      disabled={productsNeedingOrder.length === 0}
                    >
                      <Download size={18} />
                    </button>
                  </div>
                </div>

                {/* Stats */}
                <div className="p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Valor del Pedido</span>
                    <span className="font-bold text-gray-800">
                      ${totalOrderValue.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Sin Stock</span>
                    <span className="font-bold text-red-600">{criticalItems}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Productos Totales</span>
                    <span className="text-sm text-gray-600">{products.length}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Última Actualización</span>
                    <span className="text-sm text-gray-600">
                      {format(latestSnapshot.date, 'dd/MM', { locale: es })}
                    </span>
                  </div>
                </div>

                {/* Products to Order Preview */}
                <div className="px-4 pb-4">
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {productsNeedingOrder.slice(0, 5).map((product) => {
                      const target = product.stockObjetivo || 0;
                      const current = product.existencia || 0;
                      const missing = target - current;
                      const piezas = product.piezas || 1;
                      const toOrder = Math.ceil(missing / piezas) * piezas;
                      
                      return (
                        <div key={product.clave} className="flex justify-between items-center text-sm">
                          <span className="text-gray-600 truncate flex-1 mr-2">{product.descripcion}</span>
                          <div className="text-right">
                            <span className="font-medium text-red-600">{current}</span>
                            <span className="text-gray-400 mx-1">→</span>
                            <span className="font-bold text-emerald-600">{toOrder}</span>
                          </div>
                        </div>
                      );
                    })}
                    {productsNeedingOrder.length > 5 && (
                      <p className="text-xs text-gray-400 text-center pt-1">
                        +{productsNeedingOrder.length - 5} más productos para ordenar...
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredSuppliers.length === 0 && (
          <div className="text-center py-12">
            <Building2 size={64} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-600 mb-2">No se encontraron proveedores</h3>
            <p className="text-gray-500">Intenta con otra búsqueda</p>
          </div>
        )}
      </main>
    </div>
  );
}
