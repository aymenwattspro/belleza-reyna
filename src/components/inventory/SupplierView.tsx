'use client';

import React, { useMemo, useState } from 'react';
import { Building2, Download, FileSpreadsheet, FileText, ChevronDown, ChevronUp, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { InventorySnapshot } from '@/lib/types/inventory-timeline';
import { processOrders, groupBySupplier, generateOrderSheet, exportOrderSheetToCSV } from '@/lib/utils/ordering-engine';

interface SupplierViewProps {
  snapshot: InventorySnapshot;
}

export function SupplierView({ snapshot }: SupplierViewProps) {
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());

  // Process and group by supplier
  const supplierGroups = useMemo(() => {
    const products = processOrders(snapshot.products);
    return groupBySupplier(products);
  }, [snapshot]);

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

  const exportToCSV = (supplierName: string) => {
    const group = supplierGroups.find(g => g.supplierName === supplierName);
    if (!group) return;

    const orderSheet = generateOrderSheet(supplierName, group.products);
    const csvContent = exportOrderSheetToCSV(orderSheet);

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `pedido_${supplierName.toLowerCase().replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success(`Pedido para ${supplierName} exportado como CSV`);
  };

  const exportToXLSX = async (supplierName: string) => {
    const group = supplierGroups.find(g => g.supplierName === supplierName);
    if (!group) return;

    try {
      const orderSheet = generateOrderSheet(supplierName, group.products);

      // Dynamically import xlsx to avoid SSR issues
      const XLSX = await import('xlsx');

      const headers = [
        'Clave', 'Descripcion', 'Stock Actual', 'Stock Objetivo', 'Necesidad',
        'Piezas', 'Pedido Sugerido', 'Precio Unit', 'Total'
      ];

      const data = [
        [`Pedido para: ${supplierName}`],
        [`Fecha: ${new Date().toLocaleDateString('es-MX')}`],
        [],
        headers,
        ...orderSheet.items.map(item => [
          item.clave,
          item.descripcion,
          item.currentStock,
          item.targetStock,
          item.needed,
          item.piezas,
          item.suggestedOrder,
          item.unitPrice,
          item.totalPrice
        ]),
        [],
        ['', '', '', '', '', '', '', 'TOTAL:', orderSheet.totalInvestment]
      ];

      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Pedido');

      XLSX.writeFile(wb, `pedido_${supplierName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);

      toast.success(`Pedido para ${supplierName} exportado como Excel`);
    } catch (error) {
      toast.error('Error al exportar a Excel');
      console.error(error);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Vista por Proveedor</h2>
          <p className="text-sm text-gray-500">
            {supplierGroups.length} proveedores • {snapshot.products.length} productos
          </p>
        </div>
      </div>

      {/* Supplier Cards */}
      {supplierGroups.map((group) => (
        <div
          key={group.supplierName}
          className="glass-card rounded-2xl border-white/50 overflow-hidden"
        >
          {/* Supplier Header */}
          <div
            className="p-5 bg-gradient-to-r from-gray-50 to-white cursor-pointer hover:from-reyna-pink hover:to-white transition-all"
            onClick={() => toggleSupplier(group.supplierName)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-reyna-accent/10 flex items-center justify-center">
                  <Building2 size={20} className="text-reyna-accent" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800">{group.supplierName}</h3>
                  <p className="text-sm text-gray-500">
                    {group.totalItems} productos a pedir • {group.products.length} total
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm text-gray-500">Inversión Total</p>
                  <p className="text-lg font-bold text-emerald-600">
                    ${group.totalInvestment.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </p>
                </div>

                {expandedSuppliers.has(group.supplierName) ? (
                  <ChevronUp size={20} className="text-gray-400" />
                ) : (
                  <ChevronDown size={20} className="text-gray-400" />
                )}
              </div>
            </div>
          </div>

          {/* Expanded Content */}
          {expandedSuppliers.has(group.supplierName) && (
            <div className="border-t border-gray-100">
              {/* Action Buttons */}
              <div className="p-4 flex gap-2 bg-gray-50/50">
                <button
                  onClick={() => exportToCSV(group.supplierName)}
                  disabled={group.totalItems === 0}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                    group.totalItems === 0
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                      : "bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:shadow-sm"
                  )}
                >
                  <FileText size={16} />
                  Exportar CSV
                </button>

                <button
                  onClick={() => exportToXLSX(group.supplierName)}
                  disabled={group.totalItems === 0}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                    group.totalItems === 0
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                      : "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 hover:shadow-sm"
                  )}
                >
                  <FileSpreadsheet size={16} />
                  Exportar Excel
                </button>
              </div>

              {/* Products Table */}
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Clave</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Descripción</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Stock</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Objetivo</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Pedido</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {group.products
                      .filter(p => p.suggestedOrder > 0)
                      .map((product) => (
                        <tr key={product.clave} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm font-medium text-gray-700">{product.clave}</td>
                          <td className="px-4 py-2 text-sm text-gray-600 max-w-xs truncate">
                            {product.descripcion}
                          </td>
                          <td className="px-4 py-2 text-right text-sm text-gray-700">{product.existencia}</td>
                          <td className="px-4 py-2 text-right text-sm text-gray-600">
                            {product.stockObjetivo || '-'}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span className="text-sm font-semibold text-emerald-600">
                              {product.suggestedOrder}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-sm font-medium text-gray-700">
                            ${product.orderValue.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}

                    {group.products.filter(p => p.suggestedOrder > 0).length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                          <ShoppingCart size={32} className="mx-auto mb-2 text-gray-300" />
                          <p>No hay productos que necesiten pedido para este proveedor</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ))}

      {supplierGroups.length === 0 && (
        <div className="text-center py-12">
          <Building2 size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No hay datos de proveedores disponibles</p>
        </div>
      )}
    </div>
  );
}

// Helper
function format(date: Date, formatStr: string): string {
  const d = new Date(date);
  return formatStr
    .replace('yyyy', d.getFullYear().toString())
    .replace('MM', (d.getMonth() + 1).toString().padStart(2, '0'))
    .replace('dd', d.getDate().toString().padStart(2, '0'));
}
