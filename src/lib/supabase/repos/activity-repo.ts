'use client';

import { getSupabaseClient } from '../client';

/** A single shared activity entry, mapped from the `audit_log` table. */
export interface ActivityEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * activityRepo — read + append the shared activity feed (audit_log).
 *
 * The audit_log table is written server-side by the `log_audit()` SQL helper
 * (imports, target-stock updates, order/draft confirmations…) AND client-side via
 * `activityRepo.log(...)` for actions that don't go through an RPC (creating /
 * deleting / editing pending orders, excluding products…). Every approved user
 * shares the same feed, so the Activity tab shows what everyone is doing.
 */
export const activityRepo = {
  /** Most-recent-first activity (default 200 rows). */
  async getActivity(limit = 200): Promise<ActivityEntry[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('audit_log')
      .select('id, action, entity_type, entity_id, actor_id, actor_email, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('getActivity error:', error);
      return [];
    }

    return (data ?? []).map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      actorId: r.actor_id,
      actorEmail: r.actor_email,
      metadata: (r.metadata ?? {}) as unknown as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  },

  /**
   * Best-effort client-side activity log. Calls the server `log_audit` RPC, which
   * stamps the current user id + email automatically. Never throws — logging must
   * never break the action that triggered it.
   */
  async log(
    action: string,
    entityType: string,
    entityId?: string | null,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      await supabase.rpc('log_audit', {
        p_action: action,
        p_entity_type: entityType,
        p_entity_id: entityId ?? undefined,
        p_metadata: (metadata ?? {}),
      } as never);
    } catch (e) {
      console.error('logActivity error:', e);
    }
  },
};
