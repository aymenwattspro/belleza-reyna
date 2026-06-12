'use client';

import { getSupabaseClient } from './client';

/**
 * Subscribe to all row changes (INSERT/UPDATE/DELETE) on a public table and run
 * `onChange` whenever something changes. Returns an unsubscribe function.
 *
 * No-op (returns a noop unsubscribe) when Supabase is not configured so callers
 * can use it unconditionally inside effects.
 *
 * Usage:
 *   useEffect(() => subscribeTable('suppliers', refresh), [refresh]);
 */
export function subscribeTable(table: string, onChange: () => void): () => void {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  const channel = supabase
    .channel(`realtime:public:${table}`)
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table },
      () => onChange()
    )
    .subscribe();

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {
      /* ignore */
    }
  };
}
