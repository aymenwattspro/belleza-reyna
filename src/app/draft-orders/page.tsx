'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FileText, Calendar, Building2, Trash2, Pencil, CheckCircle2,
  Package, Clock, FileSpreadsheet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOrder } from '@/contexts/OrderContext';

import { useLanguage } from '@/contexts/LanguageContext';
import { DraftOrder } from '@/lib/db/orders-db';
import { format } from 'date-fns';

import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';


export default function DraftOrdersPage() {
  const router = useRouter();
  const { draftOrders, deleteDraft, confirmDraft, loading } = useOrder();
  const { t } = useLanguage();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<DraftOrder | null>(null);

  const handleDelete = async (id: string) => {
    await deleteDraft(id);
    setDeleteTarget(null);
    toast.success(t('draft_deleted'));
  };

  const handleConfirm = async (draft: DraftOrder) => {
    await confirmDraft(draft);
    setConfirmTarget(null);
    toast.success(t('draft_confirmed'));
  };

  // Build a filesystem-safe file name from the pending order name
  const safeFileName = (draft: DraftOrder) => {
    const base = (draft.name || 'pending_order').replace(/[^a-z0-9_\-]+/gi, '_').replace(/^_+|_+$/g, '');
    return `belleza_reyna_${base || 'pending_order'}_${format(new Date(), 'yyyy-MM-dd')}`;
  };

  // ── Export a single pending order to Excel ────────────────────────────────
  const exportExcel = (draft: DraftOrder) => {
    const rows = draft.items.map((i) => ({
      Reference: i.clave,
      Description: i.descripcion,
      Supplier: i.proveedor,
      'Current Stock': i.currentStock,
      'Units to Order': i.unitsToOrder,
      'Unit Cost ($)': i.unitCost.toFixed(2),
      'Line Total ($)': i.lineTotal.toFixed(2),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pending Order');

    // Summary rows
    XLSX.utils.sheet_add_aoa(ws, [
      [],
      ['', '', '', '', 'TOTAL PRODUCTS:', draft.totalProducts],
      ['', '', '', '', 'TOTAL VALUE ($):', draft.totalValue.toFixed(2)],
    ], { origin: -1 });

    XLSX.writeFile(wb, `${safeFileName(draft)}.xlsx`);
    toast.success(t('draft_exported_excel'));
  };

  // ── Export a single pending order to PDF ──────────────────────────────────
  const exportPDF = (draft: DraftOrder) => {
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('BELLEZA REYNA', 14, 18);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`Pending Order: ${draft.name}`, 14, 26);
    doc.text(`Supplier: ${draft.supplierName}`, 14, 32);
    doc.text(`Date: ${format(new Date(), 'dd/MM/yyyy')}`, 14, 38);
    doc.text(`Products: ${draft.totalProducts}  ·  Total: $${draft.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 14, 44);

    autoTable(doc, {
      startY: 52,
      head: [['Ref', 'Description', 'Supplier', 'Current Stock', 'Order Qty', 'Unit Cost', 'Line Total']],
      body: draft.items.map((i) => [
        i.clave,
        i.descripcion,
        i.proveedor,
        i.currentStock,
        i.unitsToOrder,
        `$${i.unitCost.toFixed(2)}`,
        `$${i.lineTotal.toFixed(2)}`,
      ]),
      foot: [['', '', '', '', '', 'TOTAL:', `$${draft.totalValue.toFixed(2)}`]],
      headStyles: { fillColor: [236, 72, 153], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      styles: { fontSize: 9, cellPadding: 3 },
    });

    doc.save(`${safeFileName(draft)}.pdf`);
    toast.success(t('draft_exported_pdf'));
  };


  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
            <FileText size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{t('draft_title')}</h1>
            <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">{t('draft_subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Empty state */}
        {draftOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center px-8">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center mb-5">
              <FileText size={36} className="text-amber-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-600 mb-2">{t('draft_none')}</h3>
            <p className="text-sm text-gray-400 mb-6 max-w-xs">{t('draft_none_hint')}</p>
            <Link
              href="/orders"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-pink-500 to-pink-600 text-white text-sm font-semibold rounded-xl hover:shadow-lg hover:shadow-pink-300/40 transition-all"
            >
              {t('orders_title')} →
            </Link>
          </div>
        )}

        {/* Draft list */}
        {draftOrders.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {draftOrders.map((draft) => (
              <div
                key={draft.id}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-amber-200 transition-all overflow-hidden flex flex-col"
              >
                {/* Card body (click to edit) */}
                <button
                  onClick={() => router.push(`/draft-orders/${draft.id}`)}
                  className="text-left p-5 flex-1"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                      <FileText size={18} className="text-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-gray-900 truncate">{draft.name}</h3>
                      <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5">
                        <Building2 size={11} /> {draft.supplierName}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide flex items-center gap-1">
                        <Package size={10} /> {t('draft_products')}
                      </p>
                      <p className="font-bold text-gray-800">{draft.totalProducts}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3">
                      <p className="text-[10px] text-emerald-500 uppercase tracking-wide">{t('draft_total')}</p>
                      <p className="font-bold text-emerald-700">
                        ${draft.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
                      <Calendar size={10} /> {t('draft_created')}: {format(new Date(draft.createdAt), 'dd MMM yyyy · HH:mm')}
                    </p>
                    <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
                      <Clock size={10} /> {t('draft_updated')}: {format(new Date(draft.updatedAt), 'dd MMM yyyy · HH:mm')}
                    </p>
                  </div>
                </button>

                {/* Action bar */}
                <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/60">
                  <button
                    onClick={() => router.push(`/draft-orders/${draft.id}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Pencil size={12} /> {t('draft_edit')}
                  </button>
                  <button
                    onClick={() => setConfirmTarget(draft)}
                    disabled={loading || draft.items.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-lg hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-40 transition-all"
                  >
                    <CheckCircle2 size={12} /> {t('draft_confirm')}
                  </button>

                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => exportExcel(draft)}
                      disabled={draft.items.length === 0}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                      title={t('draft_export_excel')}
                    >
                      <FileSpreadsheet size={13} className="text-emerald-600" /> {t('draft_export_excel')}
                    </button>
                    <button
                      onClick={() => exportPDF(draft)}
                      disabled={draft.items.length === 0}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                      title={t('draft_export_pdf')}
                    >
                      <FileText size={13} className="text-red-500" /> {t('draft_export_pdf')}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(draft.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title={t('draft_delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-2xl bg-red-100 flex items-center justify-center">
                <Trash2 size={20} className="text-red-500" />
              </div>
              <h3 className="text-base font-bold text-gray-800">{t('draft_delete')}</h3>
            </div>
            <p className="text-sm text-gray-500 mb-5">{t('draft_delete_confirm')}</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200">
                {t('cancel')}
              </button>
              <button onClick={() => handleDelete(deleteTarget)} className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600">
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm draft modal */}
      {confirmTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setConfirmTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                <CheckCircle2 size={24} className="text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">{t('draft_confirm')}</h3>
                <p className="text-sm text-gray-500">{confirmTarget.name}</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">{t('draft_products')}</span>
                <span className="font-bold text-gray-800">{confirmTarget.totalProducts}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-gray-200 pt-2">
                <span className="text-gray-700 font-medium">{t('draft_total')}</span>
                <span className="font-bold text-emerald-700 text-base">
                  ${confirmTarget.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-4">{t('draft_confirm_hint')}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmTarget(null)} className="flex-1 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200">
                {t('cancel')}
              </button>
              <button
                onClick={() => handleConfirm(confirmTarget)}
                disabled={loading}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-50"
              >
                {t('draft_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
