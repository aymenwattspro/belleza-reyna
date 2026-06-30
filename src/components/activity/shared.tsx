'use client';

/**
 * Shared Activity helpers — a single source of truth used by both the Activity
 * list (`/activity`) and the Activity Details page (`/activity/[id]`).
 *
 * Exposes: per-user colour derivation, action → icon/label/colour mapping, and
 * the structured change renderer (added / removed / qty changes / renamed +
 * scalar chips).
 */

import React from 'react';
import {
  Activity, Upload, Trash2, Target, CheckCircle2, FilePlus2, FileText,
  Ban, RotateCcw, Pencil, Plus, Minus, ArrowRight,
} from 'lucide-react';
import { useLanguage, Lang } from '@/contexts/LanguageContext';
import type { ActivityEntry } from '@/lib/supabase/repos/activity-repo';

// ── Per-user colour (consistent, derived from the email) ─────────────────────
export const USER_PALETTE = [
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

export function userColor(email: string | null) {
  if (!email) {
    return { avatar: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400', name: 'text-gray-600', border: 'border-gray-200' };
  }
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return USER_PALETTE[h % USER_PALETTE.length];
}

export function initials(email: string | null) {
  if (!email) return '?';
  const name = email.split('@')[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return chars.toUpperCase();
}

// ── Action → label key, icon and accent colour ───────────────────────────────
export type ActLabelKey =
  | 'act_import' | 'act_delete_import' | 'act_deleted' | 'act_update_target'
  | 'act_updated' | 'act_order_confirm' | 'act_draft_confirm' | 'act_draft_create'
  | 'act_draft_update' | 'act_draft_add' | 'act_draft_delete'
  | 'act_product_exclude' | 'act_product_include'
  | 'act_product_exclude_bulk' | 'act_product_include_bulk';


export function describe(entry: ActivityEntry): { labelKey: ActLabelKey | null; Icon: React.ElementType; color: string } {
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
    case 'product.exclude_bulk': return { labelKey: 'act_product_exclude_bulk', Icon: Ban, color: 'text-red-600 bg-red-50' };
    case 'product.include_bulk': return { labelKey: 'act_product_include_bulk', Icon: RotateCcw, color: 'text-emerald-600 bg-emerald-50' };
    default: return { labelKey: null, Icon: Activity, color: 'text-gray-600 bg-gray-100' };

  }
}

/** Human label for an action, translated. Falls back to the raw action string. */
export function useActivityLabel() {
  const { t } = useLanguage();
  return (e: ActivityEntry): string => {
    const { labelKey } = describe(e);
    return labelKey ? t(labelKey) : e.action;
  };
}

// ── Metadata key translation (for scalar chips) ──────────────────────────────
const META_ES: Record<string, string> = {
  product_count: 'productos', file_name: 'archivo', new: 'nuevos', updated: 'actualizados',
  unchanged: 'sin cambios', count: 'cantidad', products: 'productos', value: 'valor',
  draft_id: 'id', name: 'nombre', supplier: 'proveedor',
};
export function metaKeyLabel(key: string, lang: Lang): string {
  if (lang === 'es' && META_ES[key]) return META_ES[key];
  return key.replace(/_/g, ' ');
}

// ── Typed shapes for the structured change metadata ──────────────────────────
export type AddedItem = { ref?: string; name?: string; qty?: number };
export type RemovedItem = { ref?: string; name?: string };
export type QtyChange = { ref?: string; name?: string; from?: number; to?: number };
export type Renamed = { from?: string; to?: string };

export function asArray<T>(v: unknown): T[] | null {
  return Array.isArray(v) ? (v as T[]) : null;
}

// ── Detailed change renderer (chips + added/removed/qty/renamed) ─────────────
export function ChangeDetails({
  metadata,
  showScalars = true,
}: {
  metadata: Record<string, unknown>;
  showScalars?: boolean;
}) {
  const { t, lang } = useLanguage();
  const m = metadata ?? {};
  const added = asArray<AddedItem>(m.added);
  const removed = asArray<RemovedItem>(m.removed);
  const qty = asArray<QtyChange>(m.qty_changes);
  const renamed = (m.renamed && typeof m.renamed === 'object' ? m.renamed : null) as Renamed | null;

  const structuredKeys = new Set(['added', 'removed', 'qty_changes', 'renamed', 'count']);
  const scalar = showScalars
    ? Object.entries(m).filter(
        ([k, v]) => !structuredKeys.has(k) && v !== null && v !== undefined && v !== '' && typeof v !== 'object'
      )
    : [];

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
          <span className="font-semibold">{t('act_renamed')}:</span>
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
              <Plus size={11} /> {t('act_added')} ({added.length})
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
              <Minus size={11} /> {t('act_removed')} ({removed.length})
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
              <Pencil size={11} /> {t('act_qty_changes')} ({qty.length})
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
