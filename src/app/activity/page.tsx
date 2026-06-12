'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Upload, Trash2, Target, CheckCircle2, FilePlus2, FileText,
  Ban, RotateCcw, RefreshCw, User, Search, X, Pencil,
} from 'lucide-react';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { activityRepo, ActivityEntry } from '@/lib/supabase/repos/activity-repo';
import { subscribeTable } from '@/lib/supabase/realtime';

// ── Map an audit action → a human label, icon and accent colour ──────────────
function describe(entry: ActivityEntry): { label: string; Icon: React.ElementType; color: string } {
  const { action, entityType } = entry;
  switch (action) {
    case 'import':
      return { label: 'Imported inventory', Icon: Upload, color: 'text-blue-600 bg-blue-50' };
    case 'delete':
      if (entityType === 'inventory') return { label: 'Deleted an import', Icon: Trash2, color: 'text-red-600 bg-red-50' };
      return { label: 'Deleted', Icon: Trash2, color: 'text-red-600 bg-red-50' };
    case 'update':
      if (entityType === 'target_stock') return { label: 'Updated target stock', Icon: Target, color: 'text-indigo-600 bg-indigo-50' };
      return { label: 'Updated', Icon: Pencil, color: 'text-indigo-600 bg-indigo-50' };
    case 'order.confirm':
      return { label: 'Confirmed an order', Icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' };
    case 'draft.confirm':
      return { label: 'Confirmed a pending order', Icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' };
    case 'draft.create':
      return { label: 'Created a pending order', Icon: FilePlus2, color: 'text-amber-600 bg-amber-50' };
    case 'draft.update':
      return { label: 'Edited a pending order', Icon: FileText, color: 'text-amber-600 bg-amber-50' };
    case 'draft.add':
      return { label: 'Added products to a pending order', Icon: FilePlus2, color: 'text-amber-600 bg-amber-50' };
    case 'draft.delete':
      return { label: 'Deleted a pending order', Icon: Trash2, color: 'text-red-600 bg-red-50' };
    case 'product.exclude':
      return { label: 'Excluded a product from ordering', Icon: Ban, color: 'text-red-600 bg-red-50' };
    case 'product.include':
      return { label: 'Re-enabled a product for ordering', Icon: RotateCcw, color: 'text-emerald-600 bg-emerald-50' };
    default:
      return { label: action, Icon: Activity, color: 'text-gray-600 bg-gray-100' };
  }
}

// ── Render the metadata jsonb as readable chips ──────────────────────────────
function MetaChips({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {entries.map(([k, v]) => {
        let val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (k.toLowerCase().includes('value') && !Number.isNaN(Number(val))) {
          val = `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        }
        return (
          <span key={k} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
            <span className="font-semibold text-gray-500">{k.replace(/_/g, ' ')}</span>
            <span className="text-gray-700">{val}</span>
          </span>
        );
      })}
    </div>
  );
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, dd MMM yyyy');
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    const data = await activityRepo.getActivity(300);
    setEntries(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // Live updates — every approved user shares this feed.
    const unsub = subscribeTable('audit_log', refresh);
    return () => unsub();
  }, [refresh]);

  // Filter by actor email / action / entity
  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter((e) =>
      (e.actorEmail || '').toLowerCase().includes(q) ||
      e.action.toLowerCase().includes(q) ||
      e.entityType.toLowerCase().includes(q) ||
      describe(e).label.toLowerCase().includes(q)
    );
  }, [entries, search]);

  // Group consecutive entries by calendar day
  const groups = useMemo(() => {
    const map = new Map<string, ActivityEntry[]>();
    for (const e of filtered) {
      const d = new Date(e.createdAt);
      const key = format(d, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries());
  }, [filtered]);

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
              <h1 className="text-xl font-bold text-gray-900">Activity</h1>
              <p className="text-xs text-gray-500">{entries.length} recent events · shared across all users</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by user or action..."
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
              <RefreshCw size={15} className="text-indigo-500" /> Refresh
            </button>
          </div>
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
            <h3 className="text-lg font-semibold text-gray-500 mb-1">No activity yet</h3>
            <p className="text-sm text-gray-400">
              Imports, orders, pending-order changes and inventory edits will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map(([dayKey, dayEntries]) => (
              <div key={dayKey}>
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 sticky top-0">
                  {dayLabel(new Date(dayKey))}
                </h2>
                <div className="relative pl-5 border-l-2 border-gray-100 space-y-3">
                  {dayEntries.map((e) => {
                    const { label, Icon, color } = describe(e);
                    const when = new Date(e.createdAt);
                    return (
                      <div key={e.id} className="relative">
                        {/* Timeline dot */}
                        <span className={`absolute -left-[26px] top-3 w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
                          <Icon size={14} />
                        </span>
                        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-800">{label}</p>
                              <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5">
                                <User size={11} />
                                <span className="font-medium text-gray-600">{e.actorEmail || 'Unknown user'}</span>
                                {e.entityId && (
                                  <span className="font-mono text-[10px] text-gray-300 truncate">· {e.entityId}</span>
                                )}
                              </p>
                              <MetaChips metadata={e.metadata} />
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[11px] text-gray-400" title={format(when, 'dd MMM yyyy HH:mm:ss')}>
                                {format(when, 'HH:mm')}
                              </p>
                              <p className="text-[10px] text-gray-300">{formatDistanceToNow(when, { addSuffix: true })}</p>
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
