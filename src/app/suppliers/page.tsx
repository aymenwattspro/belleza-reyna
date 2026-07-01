'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Package, Search, DollarSign, AlertCircle, Box, ChevronRight,
  Plus, Pencil, Trash2, X, Phone, Mail, MapPin, FileText, Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useInventory } from '@/contexts/InventoryContext';
import { useSuppliers, Supplier, SupplierInput } from '@/contexts/SupplierContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supplierKey, resolveSupplierName } from '@/lib/utils/supplier';

interface InventoryStat {
  /** Canonical, human-readable name (first spelling seen for this supplier key). */
  displayName: string;
  productCount: number;
  totalStockUnits: number;
  totalStockValue: number;
  outOfStockCount: number;
}


export default function SuppliersPage() {
  const router = useRouter();
  const { latestSnapshot } = useInventory();
  const { suppliers, addSupplier, addSupplierByName, updateSupplier, deleteSupplier } = useSuppliers();
  const { t } = useLanguage();

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  // ── Inventory stats grouped by NORMALIZED supplier key ────────────────────
  // Grouping by a canonical key (see supplierKey) makes the association
  // tolerant to case, whitespace, accents and hidden characters, so a saved
  // supplier always matches its products even when the imported `proveedor`
  // spelling differs slightly.
  const inventoryStats = useMemo(() => {
    const map = new Map<string, InventoryStat>();
    if (!latestSnapshot) return map;
    for (const p of latestSnapshot.products) {
      const displayName = resolveSupplierName(p.proveedor);
      const key = supplierKey(displayName);
      const entry = map.get(key) ?? {
        displayName,
        productCount: 0,
        totalStockUnits: 0,
        totalStockValue: 0,
        outOfStockCount: 0,
      };
      const stock = Math.max(0, p.existencia);
      entry.productCount++;
      entry.totalStockUnits += stock;
      entry.totalStockValue += stock * (p.precioC || 0);
      if (stock === 0) entry.outOfStockCount++;
      map.set(key, entry);
    }
    return map;
  }, [latestSnapshot]);

  // ── Supplier names found in inventory but NOT in the saved database ────────
  const unsavedInventorySuppliers = useMemo(() => {
    const savedKeys = new Set(suppliers.map((s) => supplierKey(s.name)));
    const result: { name: string; stat: InventoryStat }[] = [];
    for (const [key, stat] of inventoryStats) {
      if (!savedKeys.has(key)) {
        result.push({ name: stat.displayName, stat });
      }
    }
    return result.sort((a, b) => b.stat.productCount - a.stat.productCount);
  }, [inventoryStats, suppliers]);


  // ── Filtered saved suppliers ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.contactPerson || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q)
    );
  }, [suppliers, search]);

  // ── Global stats ──────────────────────────────────────────────────────────
  const totalInventoryProducts = useMemo(
    () => Array.from(inventoryStats.values()).reduce((a, b) => a + b.productCount, 0),
    [inventoryStats]
  );
  const totalStockValue = useMemo(
    () => Array.from(inventoryStats.values()).reduce((a, b) => a + b.totalStockValue, 0),
    [inventoryStats]
  );

  // ── Modal handlers ────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setModalOpen(true); };

  const handleSubmit = async (input: SupplierInput) => {
    if (!input.name.trim()) { toast.error(t('sup_name_required')); return; }
    if (editing) {
      const ok = await updateSupplier(editing.id, input);
      if (ok) { toast.success(t('sup_updated')); setModalOpen(false); }
      else toast.error(t('sup_exists'));
    } else {
      const created = await addSupplier(input);
      if (created) { toast.success(t('sup_created')); setModalOpen(false); }
      else toast.error(t('sup_exists'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteSupplier(deleteTarget.id);
    toast.success(t('sup_deleted'));
    setDeleteTarget(null);
  };

  const handleQuickAdd = async (name: string) => {
    const created = await addSupplierByName(name);
    if (created) toast.success(t('sup_created'));
    else toast.error(t('sup_exists'));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center shadow-lg shadow-pink-500/25">
              <Users size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{t('suppliers_title')}</h1>
              <p className="text-xs text-gray-500 mt-0.5">{t('sup_manage_hint')}</p>
            </div>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-pink-500 to-pink-600 rounded-xl hover:from-pink-600 hover:to-pink-700 shadow-lg shadow-pink-500/25 transition-all shrink-0"
          >
            <Plus size={16} /> {t('sup_add')}
          </button>
        </div>
      </div>

      {/* Global stats */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard label={t('sup_saved_count')} value={suppliers.length} color="pink" icon={Users} />
          <StatCard label={t('suppliers_total_products')} value={totalInventoryProducts} color="indigo" icon={Package} />
          <StatCard
            label={t('suppliers_stock_value')}
            value={`$${totalStockValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
            color="emerald"
            icon={DollarSign}
          />
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Search */}
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t('suppliers_search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-pink-400 bg-white"
          />
        </div>

        {/* Empty state */}
        {suppliers.length === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200">
            <Box size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-500 mb-2">{t('sup_none')}</h3>
            <p className="text-sm text-gray-400 mb-5 max-w-xs mx-auto">{t('sup_none_hint')}</p>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 bg-pink-500 text-white rounded-xl text-sm font-medium hover:bg-pink-600 transition-colors"
            >
              <Plus size={15} /> {t('sup_add')}
            </button>
          </div>
        )}

        {/* Supplier cards */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((supplier) => {
              const stat = inventoryStats.get(supplierKey(supplier.name));
              return (
                <div
                  key={supplier.id}
                  className="bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md hover:border-pink-200 transition-all group flex flex-col"
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center shadow-sm shadow-pink-500/25 shrink-0">
                        <Building2 size={18} className="text-white" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-gray-900 truncate">{supplier.name}</h3>
                        <p className="text-xs text-gray-400">
                          {stat
                            ? `${stat.productCount} ${t('sup_products_in_inv')}`
                            : t('sup_no_products_inv')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(supplier)}
                        className="p-1.5 text-gray-400 hover:text-pink-500 hover:bg-pink-50 rounded-lg transition-colors"
                        title={t('sup_edit')}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(supplier)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title={t('sup_delete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Contact info */}
                  <div className="space-y-1.5 mb-3 flex-1">
                    {supplier.contactPerson && (
                      <p className="flex items-center gap-2 text-xs text-gray-600">
                        <Users size={12} className="text-gray-400 shrink-0" />
                        <span className="truncate">{supplier.contactPerson}</span>
                      </p>
                    )}
                    {supplier.phone && (
                      <p className="flex items-center gap-2 text-xs text-gray-600">
                        <Phone size={12} className="text-gray-400 shrink-0" />
                        <span className="truncate">{supplier.phone}</span>
                      </p>
                    )}
                    {supplier.email && (
                      <p className="flex items-center gap-2 text-xs text-gray-600">
                        <Mail size={12} className="text-gray-400 shrink-0" />
                        <span className="truncate">{supplier.email}</span>
                      </p>
                    )}
                    {supplier.address && (
                      <p className="flex items-center gap-2 text-xs text-gray-600">
                        <MapPin size={12} className="text-gray-400 shrink-0" />
                        <span className="truncate">{supplier.address}</span>
                      </p>
                    )}
                    {supplier.notes && (
                      <p className="flex items-start gap-2 text-xs text-gray-500 italic">
                        <FileText size={12} className="text-gray-400 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{supplier.notes}</span>
                      </p>
                    )}
                    {!supplier.contactPerson && !supplier.phone && !supplier.email && !supplier.address && !supplier.notes && (
                      <p className="text-xs text-gray-300 italic">{t('sup_contact')} —</p>
                    )}
                  </div>

                  {/* Inventory stats */}
                  {stat && (
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100 mb-3">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">{t('suppliers_stock_units')}</p>
                        <p className="font-bold text-gray-800 text-sm">{stat.totalStockUnits.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">{t('suppliers_stock_value')}</p>
                        <p className="font-bold text-gray-800 text-sm">
                          ${stat.totalStockValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-red-400 uppercase tracking-wide">{t('suppliers_oos')}</p>
                        <p className="font-bold text-red-600 text-sm">{stat.outOfStockCount}</p>
                      </div>
                    </div>
                  )}

                  {/* View products link */}
                  {stat && stat.productCount > 0 && (
                    <button
                      onClick={() => router.push(`/suppliers/${encodeURIComponent(supplier.name)}`)}
                      className="flex items-center justify-center gap-1 text-xs font-medium text-pink-600 hover:text-pink-700 py-1.5 rounded-lg hover:bg-pink-50 transition-colors"
                    >
                      {t('sup_view_products')} <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* No search results */}
        {suppliers.length > 0 && filtered.length === 0 && (
          <div className="text-center py-10 text-sm text-gray-400">{t('no_data')}</div>
        )}

        {/* Inventory suppliers not in DB */}
        {unsavedInventorySuppliers.length > 0 && (
          <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle size={15} className="text-amber-500" />
              <h3 className="text-sm font-semibold text-amber-800">
                {t('sup_in_inventory')} ({unsavedInventorySuppliers.length})
              </h3>
            </div>
            <p className="text-xs text-amber-600 mb-4">{t('sup_in_inventory_hint')}</p>
            <div className="flex flex-wrap gap-2">
              {unsavedInventorySuppliers.map(({ name, stat }) => (
                <div
                  key={name}
                  className="flex items-center gap-2 bg-white border border-amber-200 rounded-xl pl-3 pr-1.5 py-1.5"
                >
                  <Building2 size={13} className="text-amber-400" />
                  <span className="text-xs font-medium text-gray-700">{name}</span>
                  <span className="text-[10px] text-gray-400">{stat.productCount}p</span>
                  {/* View this recognized supplier's products directly — matched
                      by the exact recognized name, so products are always visible
                      even before the supplier is saved to the database. */}
                  <button
                    onClick={() => router.push(`/suppliers/${encodeURIComponent(name)}`)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 px-2 py-1 rounded-lg transition-colors"
                    title={t('sup_view_products')}
                  >
                    <ChevronRight size={11} /> {t('sup_view_products')}
                  </button>
                  <button
                    onClick={() => handleQuickAdd(name)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-white bg-amber-500 hover:bg-amber-600 px-2 py-1 rounded-lg transition-colors"
                  >
                    <Plus size={11} /> {t('sup_add_to_db')}
                  </button>

                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit modal */}
      {modalOpen && (
        <SupplierModal
          initial={editing}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-2xl bg-red-100 flex items-center justify-center">
                <Trash2 size={20} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-800">{t('sup_delete')}</h3>
                <p className="text-sm text-gray-500">{deleteTarget.name}</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-5">{t('sup_delete_confirm')}</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200">
                {t('cancel')}
              </button>
              <button onClick={handleDelete} className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600">
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add / Edit supplier modal ───────────────────────────────────────────────
function SupplierModal({
  initial, onClose, onSubmit,
}: {
  initial: Supplier | null;
  onClose: () => void;
  onSubmit: (input: SupplierInput) => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState<SupplierInput>({
    name: initial?.name || '',
    contactPerson: initial?.contactPerson || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    address: initial?.address || '',
    notes: initial?.notes || '',
  });

  const set = (key: keyof SupplierInput, value: string) => setForm((p) => ({ ...p, [key]: value }));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="text-lg font-bold text-gray-900">{initial ? t('sup_edit') : t('sup_new')}</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="p-6 space-y-4">
          <Field label={t('sup_name')} required>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400"
              placeholder={t('sup_name')}
            />
          </Field>
          <Field label={t('sup_contact_person')} optional>
            <input value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('sup_phone')} optional>
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400" />
            </Field>
            <Field label={t('sup_email')} optional>
              <input value={form.email} onChange={(e) => set('email', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400" />
            </Field>
          </div>
          <Field label={t('sup_address')} optional>
            <input value={form.address} onChange={(e) => set('address', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400" />
          </Field>
          <Field label={t('sup_notes')} optional>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400 resize-none"
              placeholder={t('sup_notes')} />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
            {t('cancel')}
          </button>
          <button
            onClick={() => onSubmit(form)}
            disabled={!form.name.trim()}
            className="px-5 py-2 bg-pink-500 text-white text-sm font-semibold rounded-xl hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('sup_save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, optional, children }: { label: string; required?: boolean; optional?: boolean; children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
        {optional && <span className="text-gray-300 font-normal normal-case ml-1">({t('sup_optional')})</span>}
      </label>
      {children}
    </div>
  );
}

// ── Stat card ───────────────────────────────────────────────────────────────
function StatCard({
  label, value, color, icon: Icon,
}: {
  label: string;
  value: string | number;
  color: 'pink' | 'indigo' | 'emerald' | 'red';
  icon: React.ElementType;
}) {
  const colors = {
    pink: { bg: 'bg-pink-50', border: 'border-pink-100', iconBg: 'bg-pink-100', text: 'text-pink-600' },
    indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100', iconBg: 'bg-indigo-100', text: 'text-indigo-600' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', iconBg: 'bg-emerald-100', text: 'text-emerald-600' },
    red: { bg: 'bg-red-50', border: 'border-red-100', iconBg: 'bg-red-100', text: 'text-red-600' },
  };
  const c = colors[color];
  return (
    <div className={cn('rounded-xl p-4 border flex items-center gap-3', c.bg, c.border)}>
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', c.iconBg)}>
        <Icon size={16} className={c.text} />
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className={cn('text-xl font-bold leading-tight', c.text)}>{value}</p>
      </div>
    </div>
  );
}
