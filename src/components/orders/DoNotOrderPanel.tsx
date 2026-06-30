'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban, Search, X, RotateCcw, CheckSquare, Square, PackageX, Building2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useOrder } from '@/contexts/OrderContext';
import { useLanguage } from '@/contexts/LanguageContext';

interface DoNotOrderPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * DoNotOrderPanel — a self-contained slide-over drawer that hosts the
 * "Do Not Order" list. It reads/writes through OrderContext so the Total Order
 * and Do Not Order lists stay synchronized after every action.
 *
 * Features:
 *  - Search bar to quickly find excluded products.
 *  - Multi-selection (per-row + select-all).
 *  - Bulk "Restore to Total Order" (single click) that preserves product data
 *    and the existing ordering logic (handled by OrderContext.includeProducts).
 */
export function DoNotOrderPanel({ open, onClose }: DoNotOrderPanelProps) {
  const { excludedProducts, includeProducts } = useOrder();
  const { t } = useLanguage();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(false);

  // Close on Escape for a natural drawer feel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keep selection valid as the list changes (restores, realtime updates from
  // other users). This is a legitimate sync of external (context) state into the
  // local selection set, so the set-state-in-effect rule is intentionally
  // suppressed here — mirroring the convention used in OrderContext.
  useEffect(() => {
    const valid = new Set(excludedProducts.map((p) => p.clave));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const c of prev) {
        if (valid.has(c)) next.add(c);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [excludedProducts]);


  // Filter + sort the excluded products by the search query.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? excludedProducts.filter(
          (p) =>
            p.clave.toLowerCase().includes(q) ||
            p.descripcion.toLowerCase().includes(q) ||
            p.proveedor.toLowerCase().includes(q)
        )
      : excludedProducts;
    return [...list].sort((a, b) => a.descripcion.localeCompare(b.descripcion));
  }, [excludedProducts, search]);

  const filteredClaves = useMemo(() => filtered.map((p) => p.clave), [filtered]);
  const allFilteredSelected =
    filteredClaves.length > 0 && filteredClaves.every((c) => selected.has(c));

  const toggleOne = (clave: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave);
      else next.add(clave);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredClaves.forEach((c) => next.delete(c));
      else filteredClaves.forEach((c) => next.add(c));
      return next;
    });
  };

  const handleRestore = async () => {
    const claves = [...selected];
    if (claves.length === 0) return;
    setRestoring(true);
    try {
      await includeProducts(claves);
      setSelected(new Set());
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-label={t('orders_excluded_title')}
        aria-hidden={!open}
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-full max-w-md bg-white shadow-2xl border-l border-gray-200',
          'flex flex-col transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-rose-50 to-red-50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center shadow-lg shadow-rose-500/25 shrink-0">
              <Ban size={17} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-gray-900 truncate">{t('orders_excluded_title')}</h2>
              <p className="text-[11px] text-gray-500">
                {excludedProducts.length} {t('draft_products')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white/70 transition-colors"
            aria-label={t('close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('orders_excluded_search')}
              className="w-full pl-9 pr-9 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={t('close')}
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Toolbar: select all + selected count */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-5 pb-2">
            <button
              onClick={toggleAll}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-rose-600 transition-colors"
            >
              {allFilteredSelected ? (
                <CheckSquare size={15} className="text-rose-500" />
              ) : (
                <Square size={15} className="text-gray-300" />
              )}
              {allFilteredSelected ? t('deselect_all') : t('select_all')}
            </button>
            <span className="text-xs text-gray-400">
              <span className="font-semibold text-gray-700">{selected.size}</span> {t('selected')}
            </span>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2">
          {excludedProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <PackageX size={40} className="text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-400">{t('orders_excluded_empty')}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <Search size={36} className="text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-400">{t('orders_excluded_no_match')}</p>
            </div>
          ) : (
            filtered.map((p) => {
              const isSel = selected.has(p.clave);
              return (
                <button
                  key={p.clave}
                  onClick={() => toggleOne(p.clave)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                    isSel
                      ? 'border-rose-300 bg-rose-50/70'
                      : 'border-gray-100 bg-white hover:bg-gray-50'
                  )}
                >
                  {isSel ? (
                    <CheckSquare size={16} className="text-rose-500 shrink-0" />
                  ) : (
                    <Square size={16} className="text-gray-300 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.descripcion}</p>
                    <p className="text-[11px] text-gray-400 font-mono flex items-center gap-1.5">
                      <span>{p.clave}</span>
                      <span className="text-gray-300">·</span>
                      <Building2 size={10} className="text-gray-300" />
                      <span className="truncate">{p.proveedor}</span>
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer: bulk restore */}
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
          <button
            onClick={handleRestore}
            disabled={selected.size === 0 || restoring}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all',
              'text-white bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700',
              'shadow-lg shadow-emerald-500/25 disabled:opacity-40 disabled:shadow-none'
            )}
          >
            <RotateCcw size={15} />
            {t('orders_restore_selected')}
            {selected.size > 0 && (
              <span className="ml-0.5 text-xs bg-white/25 rounded-full px-2 py-0.5">{selected.size}</span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
