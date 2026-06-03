'use client';

import React, { useState, useEffect, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Save, CheckCircle2, Plus, Trash2, Search, X,
  Building2, Package, FileText, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOrder } from '@/contexts/OrderContext';
import { useInventory } from '@/contexts/InventoryContext';

import { useLanguage } from '@/contexts/LanguageContext';
import { DraftOrder, DraftOrderItem } from '@/lib/db/orders-db';
import { format } from 'date-fns';

export default function DraftEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { getDraft, updateDraft, confirmDraft, loading } = useOrder();
  const { latestSnapshot } = useInventory();
  const { t } = useLanguage();

  const [draft, setDraft] = useState<DraftOrder | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(true);

  // Editable local state
  const [name, setName] = useState('');
  const [items, setItems] = useState<DraftOrderItem[]>([]);
  const [dirty, setDirty] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Load draft once ───────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingDraft(true);
      const d = await getDraft(id);
      if (!active) return;
      if (!d) {
        setNotFound(true);
      } else {
        setDraft(d);
        setName(d.name);
        setItems(d.items);
      }
      setLoadingDraft(false);
    })();
    return () => { active = false; };
  }, [id, getDraft]);

  // ── Derived totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const totalValue = items.reduce((s, i) => s + i.lineTotal, 0);
    const totalUnits = items.reduce((s, i) => s + i.unitsToOrder, 0);
    return { count: items.length, totalValue, totalUnits };
  }, [items]);

  const supplierName = useMemo(() => {
    const set = new Set(items.map((i) => i.proveedor));
    return set.size === 1 ? Array.from(set)[0] : set.size === 0 ? (draft?.supplierName || 'General') : 'Mixed';
  }, [items, draft]);

  // ── Item editing ──────────────────────────────────────────────────────────
  const setQty = (clave: string, qty: number) => {
    const safe = Number.isFinite(qty) && qty >= 0 ? Math.floor(qty) : 0;
    setItems((prev) =>
      prev.map((i) => (i.clave === clave ? { ...i, unitsToOrder: safe, lineTotal: safe * i.unitCost } : i))
    );
    setDirty(true);
  };

  const removeItem = (clave: string) => {
    setItems((prev) => prev.filter((i) => i.clave !== clave));
    setDirty(true);
  };

  const addProduct = (p: { clave: string; descripcion: string; proveedor?: string; existencia: number; precioC?: number; piezas?: number }) => {
    if (items.some((i) => i.clave === p.clave)) {
      toast.error(t('draft_already_added'));
      return;
    }
    const qty = p.piezas && p.piezas > 0 ? p.piezas : 1;
    const unitCost = p.precioC || 0;
    const newItem: DraftOrderItem = {
      clave: p.clave,
      descripcion: p.descripcion,
      proveedor: p.proveedor || 'General',
      currentStock: Math.max(0, p.existencia),
      unitsToOrder: qty,
      unitCost,
      lineTotal: qty * unitCost,
    };
    setItems((prev) => [newItem, ...prev]);
    setDirty(true);
  };

  // ── Save (no confirm) ─────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!draft) return;
    const updated: DraftOrder = {
      ...draft,
      name: name.trim() || draft.name,
      supplierName,
      items,
    };
    await updateDraft(updated);
    setDraft({ ...updated });
    setDirty(false);
    toast.success(t('draft_changes_saved'));
  };

  // ── Confirm ───────────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!draft) return;
    if (items.length === 0) { toast.error(t('draft_empty_items')); return; }
    const toConfirm: DraftOrder = {
      ...draft,
      name: name.trim() || draft.name,
      supplierName,
      items,
      totalProducts: items.length,
      totalValue: items.reduce((s, i) => s + i.lineTotal, 0),
    };
    await confirmDraft(toConfirm);
    setConfirmOpen(false);
    toast.success(t('draft_confirmed'));
    router.push('/draft-orders');
  };

  // ── Inventory products available to add ───────────────────────────────────
  const addableProducts = useMemo(() => {
    if (!latestSnapshot) return [];
    const existing = new Set(items.map((i) => i.clave));
    let products = latestSnapshot.products.filter((p) => !existing.has(p.clave));
    if (addSearch.trim()) {
      const q = addSearch.toLowerCase();
      products = products.filter(
        (p) =>
          p.clave.toLowerCase().includes(q) ||
          p.descripcion.toLowerCase().includes(q) ||
          (p.proveedor || '').toLowerCase().includes(q)
      );
    }
    return products.slice(0, 60);
  }, [latestSnapshot, items, addSearch]);

  // ── Render states ─────────────────────────────────────────────────────────
  if (loadingDraft) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw size={24} className="animate-spin text-pink-400" />
      </div>
    );
  }

  if (notFound || !draft) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <button
          onClick={() => router.push('/draft-orders')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-pink-600 mb-6 transition-colors"
        >
          <ArrowLeft size={16} /> {t('draft_go_back')}
        </button>
        <div className="text-center py-16">
          <FileText size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-500">{t('draft_not_found')}</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-20">
        <button
          onClick={() => router.push('/draft-orders')}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-pink-600 mb-3 transition-colors"
        >
          <ArrowLeft size={12} /> {t('draft_back')}
        </button>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[240px]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25 shrink-0">
              <FileText size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setDirty(true); }}
                placeholder={t('draft_name_placeholder')}
                className="w-full text-lg font-bold text-gray-900 outline-none border-b border-transparent focus:border-pink-300 bg-transparent"
              />
              <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5">
                <Building2 size={11} /> {supplierName} · {t('draft_updated')}: {format(new Date(draft.updatedAt), 'dd MMM HH:mm')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {dirty && (
              <span className="flex items-center gap-1 text-[11px] text-amber-600 font-medium">
                <AlertTriangle size={12} /> {t('draft_unsaved')}
              </span>
            )}
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <Plus size={15} className="text-pink-500" /> {t('draft_add_product')}
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <Save size={15} className="text-indigo-500" /> {t('draft_save_changes')}
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={loading || items.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-40 shadow-lg shadow-emerald-500/25 transition-all"
            >
              <CheckCircle2 size={15} /> {t('draft_confirm')}
            </button>
          </div>
        </div>
      </div>

      {/* Totals */}
      <div className="bg-white border-b border-gray-100 px-6 py-5">
        <div className="grid grid-cols-3 gap-6">
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t('draft_total')}</p>
            <p className="text-2xl font-bold text-emerald-600">
              ${totals.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t('draft_products')}</p>
            <p className="text-2xl font-bold text-gray-900">{totals.count}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t('orders_units')}</p>
            <p className="text-2xl font-bold text-gray-900">{totals.totalUnits}</p>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="p-6">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-dashed border-gray-200">
            <Package size={40} className="text-gray-300 mb-3" />
            <p className="text-sm text-gray-500 mb-4">{t('draft_empty_items')}</p>
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-pink-500 text-white rounded-xl text-sm font-medium hover:bg-pink-600 transition-colors"
            >
              <Plus size={15} /> {t('draft_add_product')}
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders_ref')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders_description')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders_supplier')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders_current_stock')}</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">{t('draft_qty')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders_unit_cost')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders_line_total')}</th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <tr key={item.clave} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-blue-600">{item.clave}</td>
                      <td className="px-4 py-3">
                        <p className="text-gray-800 font-medium line-clamp-1 max-w-[220px]">{item.descripcion}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-xs text-gray-500">
                          <Building2 size={12} className="text-gray-400" /> {item.proveedor}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{item.currentStock}</td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="number"
                          min={0}
                          value={item.unitsToOrder}
                          onChange={(e) => setQty(item.clave, parseInt(e.target.value, 10))}
                          className="w-20 px-2 py-1.5 text-center rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400 tabular-nums"
                        />
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">${item.unitCost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800">${item.lineTotal.toFixed(2)}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => removeItem(item.clave)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title={t('draft_remove')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-sm font-medium text-gray-500">
                      {totals.count} {t('draft_products')}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-gray-800">{totals.totalUnits}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">{t('draft_total')}:</td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-700">
                      ${totals.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add product modal */}
      {addOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setAddOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">{t('draft_add_product')}</h3>
              <button onClick={() => setAddOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
            </div>

            <div className="px-6 py-3 border-b border-gray-100">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  placeholder={t('draft_search_add')}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-pink-400"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!latestSnapshot ? (
                <div className="text-center py-12 text-sm text-gray-400">{t('draft_no_inventory_add')}</div>
              ) : addableProducts.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-400">{t('inv_no_match')}</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {addableProducts.map((p) => (
                      <tr key={p.clave} className="hover:bg-pink-50/40 transition-colors">
                        <td className="px-5 py-2.5">
                          <p className="font-medium text-gray-800 truncate max-w-[280px]">{p.descripcion}</p>
                          <p className="text-[10px] text-gray-400 font-mono">{p.clave} · {p.proveedor || 'General'}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-500 whitespace-nowrap">
                          {t('inv_stock')}: {Math.max(0, p.existencia)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-500 whitespace-nowrap">
                          ${(p.precioC || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <button
                            onClick={() => addProduct(p)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-pink-500 hover:bg-pink-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <Plus size={12} /> {t('draft_add_product')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-end px-6 py-3 border-t border-gray-100">
              <button onClick={() => setAddOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setConfirmOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                <CheckCircle2 size={24} className="text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">{t('draft_confirm')}</h3>
                <p className="text-sm text-gray-500">{name || draft.name}</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">{t('draft_products')}</span>
                <span className="font-bold text-gray-800">{totals.count}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-gray-200 pt-2">
                <span className="text-gray-700 font-medium">{t('draft_total')}</span>
                <span className="font-bold text-emerald-700 text-base">
                  ${totals.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-4">{t('draft_confirm_hint')}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmOpen(false)} className="flex-1 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200">
                {t('cancel')}
              </button>
              <button
                onClick={handleConfirm}
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
