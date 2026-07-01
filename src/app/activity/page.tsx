'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, RefreshCw, Search, X, Filter, ChevronRight, ChevronDown } from 'lucide-react';

import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale';
import { activityRepo, ActivityEntry } from '@/lib/supabase/repos/activity-repo';
import { subscribeTable } from '@/lib/supabase/realtime';
import { useLanguage } from '@/contexts/LanguageContext';
import { describe, userColor, initials, useActivityLabel, ChangeDetails } from '@/components/activity/shared';
import { ActivityListSkeleton } from '@/components/activity/skeletons';

export default function ActivityPage() {
  const { t, lang } = useLanguage();
  const dfLocale = useMemo(() => (lang === 'es' ? { locale: es } : undefined), [lang]);
  const labelOf = useActivityLabel();

  const PAGE_SIZE = 200;

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // How many rows we currently request from the server. Grows via "Load more"
  // so the feed is no longer capped at a fixed number of entries.
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Distinct users/actions across the WHOLE history (migration 012 RPC) so the
  // filter dropdowns list everything since the beginning — not just loaded rows.
  const [filterOptions, setFilterOptions] = useState<{ actors: string[]; actions: string[] }>({
    actors: [],
    actions: [],
  });

  const refresh = useCallback(async () => {
    // The user/action filters are applied SERVER-SIDE so filtering spans the
    // ENTIRE history, not just loaded rows. Fetch one extra row to know whether
    // more history exists beyond `limit`.
    const data = await activityRepo.getActivity({
      limit: limit + 1,
      actorEmail: userFilter !== 'all' ? userFilter : undefined,
      action: actionFilter !== 'all' ? actionFilter : undefined,
    });
    setHasMore(data.length > limit);
    setEntries(data.slice(0, limit));
    setLoading(false);
    setLoadingMore(false);
  }, [limit, userFilter, actionFilter]);


  useEffect(() => {
    // Initial fetch + live subscription. This is a legitimate React↔external
    // (Supabase) sync, so the set-state-in-effect rule is intentionally allowed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const unsub = subscribeTable('audit_log', refresh);
    return () => unsub();
  }, [refresh]);

  // Load the full-history filter options once on mount.
  useEffect(() => {
    activityRepo.getFilterOptions().then(setFilterOptions).catch(() => {});
  }, []);

  // When a server-side filter (user/action) changes, restart paging from the
  // first page so results are drawn from the whole history, not a stale offset.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLimit(PAGE_SIZE);
  }, [userFilter, actionFilter]);



  const dayLabelOf = useCallback((date: Date) => {
    if (isToday(date)) return t('act_today');
    if (isYesterday(date)) return t('act_yesterday');
    return format(date, 'EEEE, dd MMM yyyy', dfLocale);
  }, [t, dfLocale]);

  // Distinct users / actions for the filter dropdowns. Prefer the full-history
  // options (every user/action ever recorded), falling back to the loaded rows
  // only when the RPC isn't available yet.
  const userOptions = useMemo(() => {
    if (filterOptions.actors.length) return filterOptions.actors;
    const set = new Set<string>();
    for (const e of entries) if (e.actorEmail) set.add(e.actorEmail);
    return Array.from(set).sort();
  }, [filterOptions.actors, entries]);

  const actionOptions = useMemo(() => {
    const actions = filterOptions.actions.length
      ? filterOptions.actions
      : Array.from(new Set(entries.map((e) => e.action)));
    const map = new Map<string, string>();
    for (const a of actions) {
      // `labelOf` only reads `action` + `entityType`, so a minimal synthetic
      // entry is enough to render the translated action label.
      if (!map.has(a)) map.set(a, labelOf({ action: a, entityType: '' } as unknown as ActivityEntry));
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [filterOptions.actions, entries, labelOf]);


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
          <ActivityListSkeleton />
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
                      <div key={e.id} className="relative group">
                        {/* Timeline dot (action colour) */}
                        <span className={`absolute -left-[26px] top-3 w-7 h-7 rounded-lg flex items-center justify-center ${color} transition-transform duration-200 group-hover:scale-110`}>
                          <Icon size={14} />
                        </span>
                        {/* Whole card is a link to the details page */}
                        <Link
                          href={`/activity/${e.id}`}
                          aria-label={`${labelOf(e)} — ${t('act_view_details')}`}
                          className={`block bg-white rounded-xl border border-gray-100 border-l-4 ${uc.border} px-4 py-3 shadow-sm
                            transition-all duration-200 ease-out cursor-pointer
                            hover:shadow-md hover:-translate-y-0.5 hover:border-l-indigo-400
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300
                            active:translate-y-0 active:scale-[0.995]`}
                        >
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
                              <ChangeDetails metadata={e.metadata} />
                            </div>
                            <div className="flex items-start gap-1.5 shrink-0">
                              <div className="text-right">
                                <p className="text-[11px] text-gray-500" title={format(when, 'dd MMM yyyy HH:mm:ss', dfLocale)}>
                                  {format(when, 'HH:mm')}
                                </p>
                                <p className="text-[10px] text-gray-300">{formatDistanceToNow(when, { addSuffix: true, ...dfLocale })}</p>
                              </div>
                              <ChevronRight
                                size={15}
                                className="text-gray-200 mt-0.5 transition-all duration-200 group-hover:text-indigo-400 group-hover:translate-x-0.5"
                              />
                            </div>
                          </div>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Load more — fetches the next page from the server. Always shown
                while older history exists (filters apply to loaded rows, so
                pulling more lets you keep filtering deeper into the past). */}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => { setLoadingMore(true); setLimit((l) => l + PAGE_SIZE); }}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-white border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-colors disabled:opacity-60"
                >
                  {loadingMore ? (
                    <><RefreshCw size={15} className="animate-spin" /> {t('loading')}</>
                  ) : (
                    <><ChevronDown size={15} /> {t('act_load_more')}</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


