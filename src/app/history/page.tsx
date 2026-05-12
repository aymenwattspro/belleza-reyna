'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  History, Package, DollarSign, Calendar, ChevronDown, ChevronUp,
  Trash2, FileSpreadsheet, FileText, Search, Building2, Trophy, TrendingUp,
  X, Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useOrder } from '@/contexts/OrderContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ConfirmedOrder } from '@/lib/db/orders-db';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function HistoryPage() {
  const { confirmedOrders, deleteConfirmedOrder } = useOrder();
  const { t } = useLanguage();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Summary stats
  const stats = useMemo(() => {
    const totalOrders = confirmedOrders.length;
    const totalValue = confirmedOrders.reduce((s, o) => s + o.totalValue, 0);
    const totalProducts = confirmedOrders.reduce((s, o) => s + o.totalProducts, 0);
    const allItems = confirmedOrders.flatMap((o) => o.items);
    const productCounts = new Map<string, { descripcion: string; count: number }>();
    for (const item of allItems) {
      const ex = productCounts.get(item.clave);
      if (ex) { ex.count += item.unitsToOrder; }
      else productCounts.set(item.clave, { descripcion: item.descripcion, count: item.unitsToOrder });
    }
    const topProduct = [...productCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
    return { totalOrders, totalValue, totalProducts, topProduct };
  }, [confirmedOrders]);

  // Filter orders
  const filteredOrders = useMemo(() => {
    const term = searchTerm.toLowerCase();
    if (!term) return confirmedOrders;
    return confirmedOrders.filter((o) =>
      o.supplierName.toLowerCase().includes(term) ||
      o.items.some((i) => i.descripcion.toLowerCase().includes(term) || i.clave.toLowerCase().includes(term))
    );
  }, [confirmedOrders, searchTerm]);

  // Export order Excel
  const exportOrderExcel = (order: ConfirmedOrder) => {
    const rows = order.items.map((i) => ({
      Reference: i.clave,
      Description: i.descripcion,
      Supplier: i.proveedor,
      'Stock at Order': i.currentStock,
      'Units Ordered': i.unitsToOrder,
      'Unit Cost ($)': i.unitCost.toFixed(2),
      'Line Total ($)': i.lineTotal.toFixed(2),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Order');
    XLSX.writeFile(wb, `order_${order.id}.xlsx`);
    toast.success('Excel downloaded');
  };

  // Export order PDF
  const exportOrderPDF = (order: ConfirmedOrder) => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('BELLEZA REYNA — Purchase Order', 14, 18);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Confirmed: ${format(new Date(order.confirmedAt), 'dd/MM/yyyy HH:mm')}`, 14, 26);
    doc.text(`Products: ${order.totalProducts}  ·  Total: $${order.totalValue.toFixed(2)}`, 14, 32);
    autoTable(doc, {
      startY: 40,
      head: [['Ref', 'Description', 'Supplier', 'Stock', 'Qty', 'Unit Cost', 'Total']],
      body: order.items.map((i) => [i.clave, i.descripcion, i.proveedor, i.currentStock, i.unitsToOrder, `$${i.unitCost.toFixed(2)}`, `$${i.lineTotal.toFixed(2)}`]),
      foot: [['', '', '', '', '', 'TOTAL:', `$${order.totalValue.toFixed(2)}`]],
      headStyles: { fillColor: [236, 72, 153], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [243, 244, 246], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      styles: { fontSize: 8, cellPadding: 2.5 },
    });
    doc.save(`order_${order.id}.pdf`);
    toast.success('PDF downloaded');
  };

  const handleDelete = async (id: string) => {
    await deleteConfirmedOrder(id);
    setDeleteTarget(null);
    toast.success('Order deleted');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Page Header ── */}
      <div className="bg-white border-b border-gray-100">
        {/* Title row */}
        <div className="px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center shadow-lg shadow-pink-300/40">
              <History size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{t('history_title')}</h1>
              <p className="text-xs text-gray-400">{confirmedOrders.length} {t('history_items')}</p>
            </div>
          </div>
        </div>

        {/* ── 4-KPI summary bar ── */}
        {confirmedOrders.length > 0 && (
          <div className="px-6 pb-5 grid grid-cols-4 gap-4">
            {/* Total Orders */}
            <div className="bg-gradient-to-br from-rose-50 to-pink-50 border border-pink-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={14} className="text-pink-500" />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{t('history_total_orders')}</span>
              </div>
              <p className="text-2xl font-extrabold text-pink-700">{stats.totalOrders}</p>
            </div>
            {/* Total Value */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={14} className="text-emerald-500" />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{t('history_total_value')}</span>
              </div>
              <p className="text-2xl font-extrabold text-emerald-700">
                ${stats.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
            </div>
            {/* Total Products */}
            <div className="bg-gradient-to-br from-violet-50 to-indigo-50 border border-indigo-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Package size={14} className="text-indigo-500" />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{t('history_total_products')}</span>
              </div>
              <p className="text-2xl font-extrabold text-indigo-700">{stats.totalProducts}</p>
            </div>
            {/* Top Product */}
            <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Trophy size={14} className="text-amber-500" />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{t('history_top_product')}</span>
              </div>
              {stats.topProduct ? (
                <>
                  <p className="text-xs font-bold text-gray-800 line-clamp-2 leading-tight">
                    {stats.topProduct[1].descripcion}
                  </p>
                  <p className="text-[10px] text-amber-600 font-semibold mt-1">
                    {stats.topProduct[1].count} units ordered
                  </p>
                </>
              ) : (
                <p className="text-xs text-gray-400">—</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Search bar ── */}
      {confirmedOrders.length > 0 && (
        <div className="bg-white border-b border-gray-100 px-6 py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('search')}
              className="w-full pl-8 pr-8 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-pink-400 bg-gray-50 focus:bg-white transition-colors"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X size={12} className="text-gray-400" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {confirmedOrders.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center px-8">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-rose-100 to-pink-100 flex items-center justify-center mb-5">
            <History size={36} className="text-pink-400" />
          </div>
          <h3 className="text-lg font-bold text-gray-600 mb-2">{t('history_no_orders')}</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-xs">{t('history_place_first')}</p>
          <Link
            href="/orders"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-sm font-semibold rounded-xl hover:shadow-lg hover:shadow-pink-300/40 transition-all"
          >
            {t('history_go_orders')}
          </Link>
        </div>
      )}

      {/* ── Order list ── */}
      {filteredOrders.length > 0 && (
        <div className="p-6 space-y-4">
          {filteredOrders.map((order, idx) => {
            const isExpanded = expandedId === order.id;
            const confirmedDate = new Date(order.confirmedAt);

            return (
              <div
                key={order.id}
                className={cn(
                  'bg-white rounded-2xl border overflow-hidden shadow-sm transition-all duration-200',
                  isExpanded ? 'border-pink-200 shadow-md shadow-pink-100/50' : 'border-gray-200 hover:border-pink-100 hover:shadow-md'
                )}
              >
                {/* Order header */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50/50 transition-colors"
                >
                  {/* Order number badge */}
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0',
                    idx === 0
                      ? 'bg-gradient-to-br from-rose-500 to-pink-500 text-white shadow-sm shadow-pink-300/50'
                      : 'bg-gray-100 text-gray-500'
                  )}>
                    #{confirmedOrders.length - idx}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800 text-sm">{order.supplierName}</span>
                      {idx === 0 && (
                        <span className="text-[10px] bg-pink-100 text-pink-600 font-bold px-1.5 py-0.5 rounded-full">
                          {t('history_confirmed_at')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <Calendar size={11} />
                        {format(confirmedDate, 'dd MMM yyyy · HH:mm')}
                      </span>
                      <span>·</span>
                      <span>{order.totalProducts} {t('history_items')}</span>
                    </div>
                  </div>

                  {/* Value */}
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-gray-800">${order.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{order.totalProducts} SKUs</p>
                  </div>

                  {/* Expand / collapse */}
                  {isExpanded
                    ? <ChevronUp size={16} className="text-pink-400 flex-shrink-0" />
                    : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />}
                </button>

                {/* Expanded detail section */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {/* Action bar */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50 bg-gray-50/60">
                      <span className="text-xs text-gray-500 font-medium">{order.items.length} {t('history_items')}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => exportOrderExcel(order)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors font-medium"
                        >
                          <FileSpreadsheet size={12} /> Excel
                        </button>
                        <button
                          onClick={() => exportOrderPDF(order)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors font-medium"
                        >
                          <FileText size={12} /> PDF
                        </button>
                        {deleteTarget === order.id ? (
                          <div className="flex items-center gap-1.5 ml-1">
                            <button
                              onClick={() => handleDelete(order.id)}
                              className="text-[11px] bg-red-500 text-white px-2.5 py-1.5 rounded-lg font-semibold hover:bg-red-600 transition-colors"
                            >
                              {t('delete')}
                            </button>
                            <button
                              onClick={() => setDeleteTarget(null)}
                              className="text-[11px] text-gray-400 hover:text-gray-600 px-1.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                              {t('cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteTarget(order.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors ml-1"
                            title="Delete order"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Items table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Ref</th>
                            <th className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">{t('orders_description')}</th>
                            <th className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">{t('orders_supplier')}</th>
                            <th className="px-4 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wider">{t('history_stock_at_order')}</th>
                            <th className="px-4 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wider">{t('history_units_ordered')}</th>
                            <th className="px-4 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wider">{t('orders_unit_cost')}</th>
                            <th className="px-4 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wider">{t('orders_line_total')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {order.items.map((item) => (
                            <tr key={item.clave} className="hover:bg-pink-50/30 transition-colors">
                              <td className="px-4 py-2.5">
                                <Link
                                  href={`/product/${encodeURIComponent(item.clave)}`}
                                  className="font-mono text-blue-600 hover:underline text-[11px]"
                                >
                                  {item.clave}
                                </Link>
                              </td>
                              <td className="px-4 py-2.5 max-w-[200px]">
                                <p className="font-medium text-gray-800 truncate">{item.descripcion}</p>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-1">
                                  <Building2 size={10} className="text-gray-400" />
                                  <span className="text-gray-500">{item.proveedor}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right text-gray-600">{item.currentStock}</td>
                              <td className="px-4 py-2.5 text-right font-bold text-pink-600">{item.unitsToOrder}</td>
                              <td className="px-4 py-2.5 text-right text-gray-600">${item.unitCost.toFixed(2)}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-gray-800">${item.lineTotal.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-200 bg-gray-50">
                            <td colSpan={6} className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">
                              {t('orders_order_total')}:
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-emerald-700">
                              ${order.totalValue.toFixed(2)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* No results (search) */}
      {confirmedOrders.length > 0 && filteredOrders.length === 0 && searchTerm && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search size={32} className="text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">{t('no_data')}</p>
          <button onClick={() => setSearchTerm('')} className="mt-2 text-xs text-pink-500 hover:underline">{t('close')}</button>
        </div>
      )}
    </div>
  );
}
