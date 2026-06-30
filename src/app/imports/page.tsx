'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Imports — dedicated import-history page
//
//  Import history used to live on the Home page as an ever-growing horizontal
//  strip, which forced the whole dashboard to scroll sideways. It now has its
//  own page: a vertical, scrollable list that grows DOWN (never sideways), so
//  the Home dashboard stays fixed and usable no matter how many files exist.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock, Calendar, Trash2, Upload, ChevronDown, ChevronUp, Package, RefreshCw, FileSpreadsheet,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useInventory } from '@/contexts/InventoryContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ImportManager } from '@/components/inventory/ImportManager';
import { resolveSupplierName } from '@/lib/utils/supplier';
import { InventorySnapshot } from '@/lib/types/inventory-timeline';

export default function ImportsPage() {
  const { snapshots, loading, deleteSnapshot } = useInventory();
  const { t } = useLanguage();

  // Use the authoritative per-import product_count (NOT products.length, which
  // only holds the rows whose stock changed — that under-counts re-imports and
  // shows 0 for target-stock imports).
  const totalProducts = useMemo(
    () => snapshots.reduce((sum, s) => sum + (s.productCount ?? s.products.length), 0),
    [snapshots],
  );


  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center shadow-lg shadow-pink-500/25 shrink-0">
              <Clock size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900">{t('imports_title')}</h1>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{t('imports_subtitle')}</p>
            </div>
          </div>
          <ImportManager>
            {(openImport) => (
              <button
                onClick={openImport}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-pink-500 to-pink-600 rounded-xl hover:from-pink-600 hover:to-pink-700 shadow-lg shadow-pink-500/25 transition-all shrink-0"
              >
                <Upload size={16} /> {t('hub_import')}
              </button>
            )}
          </ImportManager>
        </div>
      </div>

      {/* Global stats */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="grid grid-cols-2 gap-4 max-w-md">
          <Stat label={t('inv_files')} value={snapshots.length} icon={FileSpreadsheet} />
          <Stat label={t('dash_products')} value={totalProducts} icon={Package} />
        </div>
      </div>

      {/* History list */}
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw size={22} className="text-gray-400 animate-spin" />
            </div>
          ) : snapshots.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200">
              <Upload size={48} className="mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-gray-500 mb-2">{t('imports_empty_title')}</h3>
              <p className="text-sm text-gray-400 max-w-xs mx-auto">{t('imports_empty_sub')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {snapshots.map((snap, idx) => (
                <ImportRow key={snap.id} snap={snap} isLatest={idx === 0} onDelete={deleteSnapshot} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <div className="rounded-xl p-4 border border-pink-100 bg-pink-50 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-pink-100">
        <Icon size={16} className="text-pink-600" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 truncate">{label}</p>
        <p className="text-xl font-bold leading-tight text-pink-600">{value}</p>
      </div>
    </div>
  );
}

function ImportRow({
  snap, isLatest, onDelete,
}: {
  snap: InventorySnapshot;
  isLatest: boolean;
  onDelete: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const supplier = resolveSupplierName(snap.supplierName);
  // Authoritative count (see InventorySnapshot.productCount). Falls back to the
  // changed-rows length for older imports that predate product_count.
  const count = snap.productCount ?? snap.products.length;
  const isTarget = snap.importType === 'targetstock';

  const handleDelete = async () => {

    setDeleting(true);
    try {
      await onDelete(snap.id);
      toast.success(t('sup_deleted'));
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div className={cn(
      'bg-white border rounded-2xl overflow-hidden transition-all',
      isLatest ? 'border-pink-200 ring-1 ring-pink-100' : 'border-gray-200',
    )}>
      {/* Summary row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <div className={cn(
            'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
            isLatest ? 'bg-pink-100 text-pink-600' : 'bg-gray-100 text-gray-500',
          )}>
            <Calendar size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-gray-900 truncate">{supplier}</p>
              <span className={cn(
                'text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0',
                isTarget ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600',
              )}>
                {isTarget ? t('import_mode_target') : t('import_mode_snapshot')}
              </span>
              {isLatest && (
                <span className="text-[10px] bg-pink-50 text-pink-600 px-2 py-0.5 rounded-full font-medium shrink-0">
                  {t('imports_latest')}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 truncate">
              {format(snap.date, 'dd MMM yyyy · HH:mm')} · {count} {t('dash_products')}
            </p>

          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs bg-red-500 text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-red-600 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {deleting && <RefreshCw size={11} className="animate-spin" />}
                {t('delete')}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
              >
                {t('cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title={t('hub_delete_snap')}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Expanded product list */}
      {expanded && (
        <div className="border-t border-gray-100">
          {snap.products.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">{t('no_data')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">{t('inv_product')}</th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">{t('orders_supplier')}</th>
                    <th className="px-4 py-2 text-right font-semibold text-gray-500 uppercase tracking-wider w-20">{t('inv_stock')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {snap.products.map((p) => (
                    <tr
                      key={p.clave}
                      onClick={() => router.push(`/product/${encodeURIComponent(p.clave)}`)}
                      className="hover:bg-gray-50 cursor-pointer group"
                    >
                      <td className="px-4 py-2">
                        <p className="font-medium text-gray-800 truncate max-w-[280px] group-hover:text-pink-600 transition-colors">{p.descripcion}</p>
                        <p className="text-[10px] text-gray-400 font-mono">{p.clave}</p>
                      </td>
                      <td className="px-4 py-2 text-gray-600 truncate max-w-[160px]">{resolveSupplierName(p.proveedor)}</td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums text-gray-700">{Math.max(0, p.existencia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
