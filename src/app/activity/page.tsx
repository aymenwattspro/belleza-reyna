'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Upload, Trash2, Target, CheckCircle2, FilePlus2, FileText,
  Ban, RotateCcw, RefreshCw, Search, X, Pencil, Plus, Minus, ArrowRight, Filter,
} from 'lucide-react';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale';
import { activityRepo, ActivityEntry } from '@/lib/supabase/repos/activity-repo';
import { subscribeTable } from '@/lib/supabase/realtime';
import { useLanguage, Lang } from '@/contexts/LanguageContext';

// ── Per-user colour (consistent, derived from the email) ─────────────────────
const USER_PALETTE = [
  { avatar: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500', name: 'text-rose-700', border: 'border-rose-300' },
  { avatar: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', name: 'text-blue-700', border: 'border-blue-300' },
  { avatar: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', name: 'text-emerald-700', border: 'border-emerald-300' },
  { avatar: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', name: 'text-amber-700', border: 'border-amber-300' },
  { avatar: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500', name: 'text-violet-700', border: 'border-violet-300' },
  { avatar: 'bg-cyan-100 text-cyan-700', dot: 'bg-cyan-500', name: 'text-cyan-700', border: 'border-cyan-300' },
  { avatar: 'bg-fuchsia-100 text-fuchsia-700', dot: 'bg-fuchsia-500', name: 'text-fuchsia-700', border: 'border-fuchsia-300' },
  { avatar: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500', name: 'text-orange-700', border: 'border-orange-300' },
  { avatar: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500', name: 'text-teal-700', border: 'border-teal-300' },
  { avatar: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500', name: 'text-indigo-700', border: 'border-indigo-300' },
];
function userColor(email: string | null) {
  if (!email) return { avatar: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400', name: 'text-gray-600', border: 'border-gray-200' };
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return USER_PALETTE[h % USER_PALETTE.length];
}
function initials(email: string | null) {
  if (!email) return '?';
  const name = email.split('@')[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return chars.toUpperCase();
}

// ── Action → label key, icon and accent colour ───────────────────────────────
type ActLabelKey =
  | 'act_import' | 'act_delete_import' | 'act_deleted' | 'act_update_target'
  | 'act_updated' | 'act_order_confirm' | 'act_draft_confirm' | 'act_draft_create'
  | 'act_draft_update' | 'act_draft_add' | 'act_draft_delete'
  | 'act_product_exclude' | 'act_product_include';

function describe(entry: ActivityEntry): { labelKey: ActLabelKey | null; Icon: React.ElementType; color: string } {
  const { action, entityType } = entry;
  switch (action) {
    case 'import': return { labelKey: 'act_import', Icon: Upload, color: 'text-blue-600 bg-blue-50' };
    case 'delete':
      if (entityType === 'inventory') return { labelKey: 'act_delete_import', Icon: Trash2, color: 'text-red-600 bg-red-50' };
      return { labelKey: 'act_deleted', Icon: Trash2, color: 'text-red-600 bg-red-50' };
    case 'update':
      if (entityType === 'target_stock') return { labelKey: 'act_update_target', Icon: Target, color: 'text-indigo-600 bg-indigo-50' };
      return { labelKey: 'act_updated', Icon: Pencil, color: 'text-indigo-600 bg-indigo-50' };
    case 'order.confirm': return { labelKey: 'act_order_confirm', Icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' };
    case 'draft.confirm': return { labelKey: 'act_draft_confirm', Icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' };
    case 'draft.create': return { labelKey: 'act_draft_create', Icon: FilePlus2, color: 'text-amber-600 bg-amber-50' };
    case 'draft.update': return { labelKey: 'act_draft_update', Icon: FileText, color: 'text-amber-600 bg-amber-50' };
    case 'draft.add': return { labelKey: 'act_draft_add', Icon: FilePlus2, color: 'text-amber-600 bg-amber-50' };
    case 'draft.delete': return { labelKey: 'act_draft_delete', Icon: Trash2, color: 'text-red-600 bg-red-50' };
    case 'product.exclude': return { labelKey: 'act_product_exclude', Icon: Ban, color: 'text-red-600 bg-red-50' };
    case 'product.include': return { labelKey: 'act_product_include', Icon: RotateCcw, color: 'text-emerald-600 bg-emerald-50' };
    default: return { labelKey: null, Icon: Activity, color: 'text-gray-600 bg-gray-100' };
  }
}

// Translate common metadata keys (jsonb) for the scalar chips.
const META_ES: Record<string, string> = {
  product_count: 'productos', file_name: 'archivo', new: 'nuevos', updated: 'actualizados',
  unchanged: 'sin cambios', count: 'cantidad', products: 'productos', value: 'valor',
  draft_id: 'id', name: 'nombre', supplier: 'proveedor',
};
function metaKeyLabel(key: string, lang: Lang): string {
  if (lang === 'es' && META_ES[key]) return META_ES[key];
  return key.replace(/_/g, ' ');
}

// Typed shapes for the structured change metadata.
type AddedItem = { ref?: string; name?: string; qty?: number };
type RemovedItem = { ref?: string; name?: string };
type QtyChange = { ref?: string; name?: string; from?: number; to?: number };
type Renamed = { from?: string; to?: string };

function asArray<T>(v: unknown): T[] | null {
  return Array.isArray(v) ? (v as T[]) : null;
}

// ── Detailed change renderer ─────────────────────────────────────────────────
function ChangeDetails({ metadata, lang, t }: { metadata: Record<string, unknown>; lang: Lang; t: (k: never) => string }) {
  const m = metadata ?? {};
  const added = asArray<AddedItem>(m.added);
  const removed = asArray<RemovedItem>(m.removed);
  const qty = asArray<QtyChange>(m.qty_changes);
  const renamed = (m.renamed && typeof m.renamed === 'object' ? m.renamed : null) as Renamed | null;

  const structuredKeys = new Set(['added', 'removed', 'qty_changes', 'renamed', 'count']);
  const scalar = Object.entries(m).filter(
    ([k, v]) => !structuredKeys.has(k) && v !== null && v !== undefined && v !== '' && typeof v !== 'object'
  );

  const hasAnything = scalar.length || added?.length || removed?.length || qty?.length || renamed;
  if (!hasAnything) return null;

  const cap = <T,>(arr: T[], n = 12) => ({ shown: arr.slice(0, n), extra: Math.max(0, arr.length - n) });

  return (
    <div className="mt-2 space-y-1.5">
      {/* Scalar chips */}
      {scalar.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scalar.map(([k, v]) => {
            let val = String(v);
            if (k.toLowerCase().includes('value') && !Number.isNaN(Number(val))) {
              val = `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
            }
            return (
              <span key={k} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                <span className="font-semibold text-gray-500">{metaKeyLabel(k, lang)}</span>
                <span className="text-gray-700">{val}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Renamed */}
      {renamed && (renamed.from || renamed.to) && (
        <div className="flex items-center gap-1.5 text-[11px] text-indigo-700 bg-indigo-50 rounded-lg px-2 py-1 w-fit">
          <Pencil size={11} />
          <span className="font-semibold">{t('act_renamed' as never)}:</span>
          <span className="line-through text-indigo-400">{renamed.from}</span>
          <ArrowRight size={10} />
          <span className="font-medium">{renamed.to}</span>
        </div>
      )}

      {/* Added products */}
      {added && added.length > 0 && (() => {
        const { shown, extra } = cap(added);
        return (
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5">
            <p className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 uppercase tracking-wide mb-1">
              <Plus size={11} /> {t('act_added' as never)} ({added.length})
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {shown.map((it, i) => (
                <span key={(it.ref ?? '') + i} className="text-[11px] text-emerald-800">
                  <span className="font-mono text-emerald-600">{it.ref}</span>{' '}
                  {it.name}{it.qty != null ? <span className="text-emerald-600"> ×{it.qty}</span> : null}
                </span>
              ))}
              {extra > 0 && <span className="text-[11px] text-emerald-600">+{extra}…</span>}
            </div>
          </div>
        );
      })()}

      {/* Removed products */}
      {removed && removed.length > 0 && (() => {
        const { shown, extra } = cap(removed);
        return (
          <div className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-1.5">
            <p className="flex items-center gap-1 text-[10px] font-bold text-red-700 uppercase tracking-wide mb-1">
              <Minus size={11} /> {t('act_removed' as never)} ({removed.length})
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {shown.map((it, i) => (
                <span key={(it.ref ?? '') + i} className="text-[11px] text-red-800">
                  <span className="font-mono text-red-600">{it.ref}</span> {it.name}
                </span>
              ))}
              {extra > 0 && <span className="text-[11px] text-red-600">+{extra}…</span>}
            </div>
          </div>
        );
      })()}

      {/* Quantity changes */}
      {qty && qty.length > 0 && (() => {
        const { shown, extra } = cap(qty);
        return (
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-1.5">
            <p className="flex items-center gap-1 text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-1">
              <Pencil size={11} /> {t('act_qty_changes' as never)} ({qty.length})
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {shown.map((it, i) => (
                <span key={(it.ref ?? '') + i} className="inline-flex items-center gap-1 text-[11px] text-amber-800">
                  <span className="font-mono text-amber-600">{it.ref}</span>
                  <span className="text-amber-500">{it.from}</span>
                  <ArrowRight size={10} />
                  <span className="font-semibold">{it.to}</span>
                </span>
              ))}
              {extra > 0 && <span className="text-[11px] text-amber-600">+{extra}…</span>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default function ActivityPage() {
  const { t, lang } = useLanguage();
  const dfLocale = useMemo(() => (lang === 'es' ? { locale: es } : undefined), [lang]);

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const refresh = useCallback(async () => {
    const data = await activityRepo.getActivity(300);
    setEntries(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const unsub = subscribeTable('audit_log', refresh);
    return () => unsub();
  }, [refresh]);

  const labelOf = useCallback((e: ActivityEntry) => {
    const { labelKey } = describe(e);
    return labelKey ? t(labelKey) : e.action;
  }, [t]);

  const dayLabelOf = useCallback((date: Date) => {
    if (isToday(date)) return t('act_today');
    if (isYesterday(date)) return t('act_yesterday');
    return format(date, 'EEEE, dd MMM yyyy', dfLocale);
  }, [t, dfLocale]);

  // Distinct users / actions for the filter dropdowns
  const userOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.actorEmail) set.add(e.actorEmail);
    return Array.from(set).sort();
  }, [entries]);

  const actionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) if (!map.has(e.action)) map.set(e.action, labelOf(e));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries, labelOf]);

  const anyFilter = userFilter !== 'all' || actionFilter !== 'all' || !!fromDate || !!toDate || !!search.trim();
  const clearFilters = () => { setUserFilter('all'); setActionFilter('all'); setFromDate(''); setToDate(''); setSearch(''); };

  // Apply all filters
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (userFilter !== 'all' && e.actorEmail !== userFilter) return false;
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      const day = format(new Date(e.createdAt), 'yyyy-MM-dd');
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      if (q) {
        const hay = `${e.actorEmail ?? ''} ${e.action} ${e.entityType} ${labelOf(e)} ${JSON.stringify(e.metadata)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, userFilter, actionFilter, fromDate, toDate, search, labelOf]);

  // Group by calendar day
  const groups = useMemo(() => {
    const map = new Map<string, ActivityEntry[]>();
    for (const e of filtered) {
      const key = format(new Date(e.createdAt), 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const selectCls = 'px-2.5 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-indigo-400 bg-white text-gray-700';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Activity size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{t('act_title')}</h1>
              <p className="text-xs text-gray-500">{entries.length} {t('act_recent_events')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('act_filter_ph')}
                className="w-56 pl-8 pr-8 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-indigo-400"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X size={12} className="text-gray-400" />
                </button>
              )}
            </div>
            <button
              onClick={refresh}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <RefreshCw size={15} className="text-indigo-500" /> {t('act_refresh')}
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <Filter size={14} className="text-gray-400" />

          {/* User filter */}
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className={selectCls}>
            <option value="all">{t('act_user_all')}</option>
            {userOptions.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>

          {/* Action filter */}
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className={selectCls}>
            <option value="all">{t('act_action_all')}</option>
            {actionOptions.map(([action, label]) => (
              <option key={action} value={action}>{label}</option>
            ))}
          </select>

          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">{t('act_from')}</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={selectCls} />
            <span className="text-xs text-gray-400">{t('act_to')}</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={selectCls} />
          </div>

          {anyFilter && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-2.5 py-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl hover:bg-red-100 transition-colors"
            >
              <X size={13} /> {t('act_clear')}
            </button>
          )}

          <span className="ml-auto text-xs text-gray-400">{filtered.length} {t('act_results')}</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 max-w-3xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <RefreshCw size={22} className="animate-spin text-indigo-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Activity size={44} className="text-gray-300 mb-3" />
            <h3 className="text-lg font-semibold text-gray-500 mb-1">
              {entries.length === 0 ? t('act_empty_title') : t('act_no_results')}
            </h3>
            <p className="text-sm text-gray-400">{t('act_empty_sub')}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map(([dayKey, dayEntries]) => (
              <div key={dayKey}>
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                  {dayLabelOf(new Date(dayKey))}
                </h2>
                <div className="relative pl-5 border-l-2 border-gray-100 space-y-3">
                  {dayEntries.map((e) => {
                    const { Icon, color } = describe(e);
                    const uc = userColor(e.actorEmail);
                    const when = new Date(e.createdAt);
                    return (
                      <div key={e.id} className="relative">
                        {/* Timeline dot (action colour) */}
                        <span className={`absolute -left-[26px] top-3 w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
                          <Icon size={14} />
                        </span>
                        <div className={`bg-white rounded-xl border border-gray-100 border-l-4 ${uc.border} px-4 py-3 shadow-sm`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {/* User + action */}
                              <div className="flex items-center gap-2">
                                <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${uc.avatar} shrink-0`}>
                                  {initials(e.actorEmail)}
                                </span>
                                <span className={`text-xs font-semibold ${uc.name} truncate`}>
                                  {e.actorEmail || t('act_unknown_user')}
                                </span>
                              </div>
                              <p className="text-sm font-semibold text-gray-800 mt-1">{labelOf(e)}</p>
                              {e.entityId && (
                                <p className="font-mono text-[10px] text-gray-300 truncate mt-0.5">{e.entityId}</p>
                              )}
                              <ChangeDetails metadata={e.metadata} lang={lang} t={t as unknown as (k: never) => string} />
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[11px] text-gray-500" title={format(when, 'dd MMM yyyy HH:mm:ss', dfLocale)}>
                                {format(when, 'HH:mm')}
                              </p>
                              <p className="text-[10px] text-gray-300">{formatDistanceToNow(when, { addSuffix: true, ...dfLocale })}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
