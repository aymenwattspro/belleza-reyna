'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ShoppingCart, CheckSquare, Square, CheckCircle2,
  FileSpreadsheet, FileText, Package, Building2, Search, X, Star, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useOrder, OrderLineItem } from '@/contexts/OrderContext';
import { useInventory } from '@/contexts/InventoryContext';
import { useLanguage } from '@/contexts/LanguageContext';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

// Uses the global InventoryProvider from app/layout.tsx — no local wrapper needed

function OrdersPageInner() {
  // ⚠️ DO NOT call buildOrderFromSnapshot here — the inventory hub page is the
  // single source of truth. It rebuilds the order whenever latestSnapshot changes.
  // Calling it again here (without settingsMap) produces a different count.
  const { orderLines, deselectedClaves, toggleDeselect, batchToggleSelect, confirmOrder, loading } = useOrder();
  const { latestSnapshot, loading: invLoading, popularityScores } = useInventory();
  const { t } = useLanguage();
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [confirmModal, setConfirmModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [recOpen, setRecOpen] = useState(true); // recommendation panel open/collapsed

  // Build a fast clave → popularityScore map for sorting
  const popularityMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of popularityScores) m.set(s.clave, s.overallScore);
    return m;
  }, [popularityScores]);

  // Supplier list
  const suppliers = useMemo(() => {
    const s = new Set(orderLines.map((l) => l.proveedor));
    return Array.from(s).sort();
  }, [orderLines]);

  // Filtered lines — sorted by popularity score (high → low) as primary sort
  const filtered = useMemo(() => {
    let lines = supplierFilter === 'all' ? orderLines : orderLines.filter((l) => l.proveedor === supplierFilter);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      lines = lines.filter((l) =>
        l.clave.toLowerCase().includes(q) ||
        l.descripcion.toLowerCase().includes(q) ||
        l.proveedor.toLowerCase().includes(q)
      );
    }
    // Sort by popularity score descending; fall back to supplier + name
    lines = [...lines].sort((a, b) => {
      const scoreA = popularityMap.get(a.clave) ?? -1;
      const scoreB = popularityMap.get(b.clave) ?? -1;
      if (scoreB !== scoreA) return scoreB - scoreA;
      const supp = a.proveedor.localeCompare(b.proveedor);
      if (supp !== 0) return supp;
      return a.descripcion.localeCompare(b.descripcion);
    });
    return lines;
  }, [orderLines, supplierFilter, searchTerm, popularityMap]);

  const selected = filtered.filter((l) => l.selected);
  const deselected = filtered.filter((l) => !l.selected);

  // Totals
  const totals = useMemo(() => {
    const sel = orderLines.filter((l) => l.selected);
    const totalValue = sel.reduce((s, l) => s + l.lineTotal, 0);
    const totalUnits = sel.reduce((s, l) => s + l.unitsToOrder, 0);
    return { count: sel.length, totalValue, totalUnits };
  }, [orderLines]);

  // Select / Deselect all visible — uses batch update to avoid stale state bug
  const toggleAll = async (select: boolean) => {
    const toChange = filtered
      .filter((line) => (select ? !line.selected : line.selected))
      .map((line) => line.clave);
    if (toChange.length > 0) await batchToggleSelect(toChange, select);
  };

  // ── Export Excel ──────────────────────────────────────────────────────────
  const exportExcel = () => {
    const rows = selected.map((l) => ({
      Reference: l.clave,
      Description: l.descripcion,
      Supplier: l.proveedor,
      'Current Stock': l.currentStock,
      'Units to Order': l.unitsToOrder,
      'Unit Cost ($)': l.unitCost.toFixed(2),
      'Line Total ($)': l.lineTotal.toFixed(2),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Order');

    // Summary row
    XLSX.utils.sheet_add_aoa(ws, [
      [],
      ['', '', '', '', 'TOTAL PRODUCTS:', selected.length],
      ['', '', '', '', 'TOTAL VALUE ($):', totals.totalValue.toFixed(2)],
    ], { origin: -1 });

    XLSX.writeFile(wb, `belleza_reyna_order_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('Excel downloaded');
  };

  // ── Export PDF ────────────────────────────────────────────────────────────
  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('BELLEZA REYNA', 14, 18);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Purchase Order', 14, 26);
    doc.text(`Date: ${format(new Date(), 'dd/MM/yyyy')}`, 14, 32);
    doc.text(`Products: ${selected.length}  ·  Total: $${totals.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 14, 38);

    autoTable(doc, {
      startY: 46,
      head: [['Ref', 'Description', 'Supplier', 'Current Stock', 'Order Qty', 'Unit Cost', 'Line Total']],
      body: selected.map((l) => [
        l.clave,
        l.descripcion,
        l.proveedor,
        l.currentStock,
        l.unitsToOrder,
        `$${l.unitCost.toFixed(2)}`,
        `$${l.lineTotal.toFixed(2)}`,
      ]),
      foot: [['', '', '', '', '', 'TOTAL:', `$${totals.totalValue.toFixed(2)}`]],
      headStyles: { fillColor: [236, 72, 153], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      styles: { fontSize: 9, cellPadding: 3 },
    });

    doc.save(`belleza_reyna_order_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success('PDF downloaded');
  };

  // ── Confirm Order ─────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    const selectedLines = orderLines.filter((l) => l.selected);
    await confirmOrder(selectedLines);
    setConfirmModal(false);
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (invLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center shadow-lg shadow-pink-500/25">
                <ShoppingCart size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t('orders_title')}</h1>
                <p className="text-xs text-gray-500">
                  {totals.count} {t('selected')} · ${totals.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} total
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportExcel}
              disabled={selected.length === 0}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              <FileSpreadsheet size={15} className="text-emerald-600" /> Excel
            </button>
            <button
              onClick={exportPDF}
              disabled={selected.length === 0}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              <FileText size={15} className="text-red-500" /> PDF
            </button>
            <button
              onClick={() => setConfirmModal(true)}
              disabled={selected.length === 0 || loading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-pink-500 to-pink-600 rounded-xl hover:from-pink-600 hover:to-pink-700 disabled:opacity-40 shadow-lg shadow-pink-500/25 transition-all"
            >
              <CheckCircle2 size={15} /> {t('orders_confirm')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Key Metrics (prominent, always visible) ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-5">
        <div className="grid grid-cols-3 gap-6">
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Order Value</p>
            <p className="text-3xl font-bold text-emerald-600">
              ${totals.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Products Selected</p>
            <p className="text-3xl font-bold text-gray-900">{totals.count}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Units</p>
            <p className="text-3xl font-bold text-gray-900">{totals.totalUnits}</p>
          </div>
        </div>
      </div>

      {/* ── Filter / Search Bar ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search product..."
              className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X size={12} className="text-gray-400" />
              </button>
            )}
          </div>

          {/* Supplier filter */}
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 outline-none bg-white"
          >
            <option value="all">All suppliers</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <div className="h-4 w-px bg-gray-200" />

          <button onClick={() => toggleAll(true)} className="text-xs px-2.5 py-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium">
            Select all
          </button>
          <button onClick={() => toggleAll(false)} className="text-xs px-2.5 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
            Deselect all
          </button>

          <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
            <span><span className="font-medium text-gray-700">{totals.count}</span> selected</span>
            <span>·</span>
            <span><span className="font-medium text-gray-500">{orderLines.filter((l) => !l.selected).length}</span> skipped</span>
          </div>
        </div>
      </div>

      {/* ── Priority Recommendation Banner ──────────────────────────────────
          Shows the top products from the current order ranked by popularity.
          This is a SUGGESTION only — no product is forced in or out.
      ────────────────────────────────────────────────────────────────────── */}
      {popularityScores.length > 0 && orderLines.length > 0 && (() => {
        // Top 5 selected order lines by popularity score
        const topRecs = [...orderLines]
          .filter(l => l.selected && popularityMap.has(l.clave))
          .sort((a, b) => (popularityMap.get(b.clave) ?? 0) - (popularityMap.get(a.clave) ?? 0))
          .slice(0, 5);
        if (topRecs.length === 0) return null;
        return (
          <div className="mx-6 mt-4 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/60 to-violet-50/60 overflow-hidden">
            {/* Header */}
            <button
              onClick={() => setRecOpen(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-indigo-50/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Star size={15} className="text-yellow-500 fill-yellow-500" />
                <span className="text-sm font-semibold text-indigo-800">Priority Picks</span>
                <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-normal">Top {topRecs.length} by popularity</span>
                <span className="text-xs text-indigo-400">— recommendation only, you decide</span>
              </div>
              {recOpen ? <ChevronUp size={14} className="text-indigo-400" /> : <ChevronDown size={14} className="text-indigo-400" />}
            </button>
            {recOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 px-5 pb-4">
                {topRecs.map((line, i) => {
                  const score = popularityMap.get(line.clave) ?? 0;
                  const scoreColor = score >= 70 ? 'text-emerald-600 bg-emerald-50' : score >= 30 ? 'text-blue-600 bg-blue-50' : 'text-gray-500 bg-gray-100';
                  return (
                    <div key={line.clave} className="bg-white/80 rounded-xl p-3 border border-indigo-100 shadow-sm">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-xs font-black text-indigo-200">#{i + 1}</span>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-semibold', scoreColor)}>
                          <Zap size={8} className="inline mr-0.5" />{score.toFixed(0)}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-gray-800 line-clamp-2 mb-1">{line.descripcion}</p>
                      <p className="text-[10px] text-gray-400">{line.proveedor} · {line.unitsToOrder} u to order</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* No data state */}
      {orderLines.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center px-8">
          {!latestSnapshot ? (
            <>
              <Package size={48} className="text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-gray-500 mb-2">No inventory imported</h3>
              <p className="text-gray-400 mb-4">Import an inventory file first to see products that need ordering.</p>
              <Link href="/inventory-hub" className="px-4 py-2 bg-pink-500 text-white rounded-xl text-sm font-medium hover:bg-pink-600 transition-colors">
                Go to Home →
              </Link>
            </>
          ) : (
            <>
              <CheckCircle2 size={48} className="text-emerald-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-500 mb-2">All stock levels are OK!</h3>
              <p className="text-gray-400">No products need ordering right now.</p>
            </>
          )}
        </div>
      )}

      {/* Order Table */}
      {filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={selected.length === filtered.length && filtered.length > 0}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Ref</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Supplier</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Current Stock</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Units to Order</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Unit Cost</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filtered.map((line) => (
                <tr
                  key={line.clave}
                  className={cn(
                    'transition-colors',
                    !line.selected ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'
                  )}
                >
                  <td className="px-4 py-3">
                    <button onClick={() => toggleDeselect(line.clave)}>
                      {line.selected ? (
                        <CheckSquare size={16} className="text-pink-500" />
                      ) : (
                        <Square size={16} className="text-gray-300" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/product/${encodeURIComponent(line.clave)}`}
                      className="font-mono text-xs font-medium text-blue-600 hover:underline"
                    >
                      {line.clave}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-800 font-medium line-clamp-1">{line.descripcion}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Building2 size={12} className="text-gray-400" />
                      <span className="text-xs text-gray-500">{line.proveedor}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('font-medium', line.currentStock === 0 ? 'text-red-600' : 'text-gray-700')}>
                      {line.currentStock}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-bold text-pink-600">{line.unitsToOrder}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    ${line.unitCost.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-semibold text-gray-800">${line.lineTotal.toFixed(2)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Footer totals */}
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-sm font-medium text-gray-500">
                  {totals.count} products selected
                </td>
                <td className="px-4 py-3 text-right font-bold text-gray-800">{totals.totalUnits}</td>
                <td className="px-4 py-3 text-right text-sm text-gray-500">Total:</td>
                <td className="px-4 py-3 text-right font-bold text-emerald-700">
                  ${totals.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Confirm Modal ── */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center">
                <CheckCircle2 size={24} className="text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">Confirm Order</h3>
                <p className="text-sm text-gray-500">This will move the order to history.</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Products to order</span>
                <span className="font-bold text-gray-800">{totals.count}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total units</span>
                <span className="font-bold text-gray-800">{totals.totalUnits}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-gray-200 pt-2 mt-2">
                <span className="text-gray-700 font-medium">Order total</span>
                <span className="font-bold text-emerald-700 text-base">
                  ${totals.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-400 mb-4">
              Selected products will be confirmed and moved to Order History. Deselected products will remain in this list.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(false)}
                className="flex-1 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-pink-500 to-pink-600 rounded-xl hover:from-pink-600 hover:to-pink-700 disabled:opacity-50"
              >
                {loading ? 'Confirming...' : 'Confirm & Place Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Uses the global InventoryProvider already mounted in app/layout.tsx
export default function OrdersPage() {
  return <OrdersPageInner />;
}
