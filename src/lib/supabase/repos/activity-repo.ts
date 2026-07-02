'use client';


import { getSupabaseClient } from '../client';
import { getAuditContext } from '@/lib/audit/context';

// ── Shapes for the enriched audit metadata (migration 007) ───────────────────
export interface AuditDeviceInfo {
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  deviceType?: string;
}

export interface AuditGeoInfo {
  country?: string | null;
  region?: string | null;
  city?: string | null;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

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
  // ── Audit metadata (nullable for historical rows) ──
  sessionId: string | null;
  requestId: string | null;
  source: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  geo: AuditGeoInfo | null;
  device: AuditDeviceInfo | null;
}

/** Limited public profile of an actor (via `get_actor_profile` RPC). */
export interface ActorProfile {
  id: string;
  email: string | null;
  role: string;
  createdAt: string;
}

/** Aggregated activity counters for the User Investigation panel. */
export interface UserActivityStats {
  today: number;
  week: number;
  total: number;
  firstAt: string | null;
  lastAt: string | null;
}

/** Reference to an actor — we prefer actor_id, falling back to actor_email. */
export interface ActorRef {
  actorId?: string | null;
  actorEmail?: string | null;
}

/**
 * Query options for `getActivity`. `actorEmail` / `action` are applied
 * server-side so filtering spans the ENTIRE history, not just loaded rows.
 */
export interface ActivityQuery {
  limit?: number;
  actorEmail?: string;
  action?: string;
  /** Inclusive lower bound on created_at (ISO instant). */
  fromIso?: string;
  /** Inclusive upper bound on created_at (ISO instant). */
  toIso?: string;
}



// All columns we read for an activity row.
const ACTIVITY_COLUMNS =
  'id, action, entity_type, entity_id, actor_id, actor_email, metadata, created_at, ' +
  'session_id, request_id, source, user_agent, ip_address, geo, device';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any): ActivityEntry {
  return {
    id: r.id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
    sessionId: r.session_id ?? null,
    requestId: r.request_id ?? null,
    source: r.source ?? null,
    userAgent: r.user_agent ?? null,
    ipAddress: r.ip_address ?? null,
    geo: (r.geo ?? null) as AuditGeoInfo | null,
    device: (r.device ?? null) as AuditDeviceInfo | null,
  };
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
  /**
   * Most-recent-first activity. Accepts either a plain row limit (legacy) or a
   * query object. The `actorEmail` / `action` filters are applied SERVER-SIDE so
   * filtering reaches the ENTIRE history, not just the rows already loaded.
   */
  async getActivity(arg: number | ActivityQuery = 200): Promise<ActivityEntry[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const opts: ActivityQuery = typeof arg === 'number' ? { limit: arg } : arg;
    const limit = opts.limit ?? 200;

    let query = supabase
      .from('audit_log')
      .select(ACTIVITY_COLUMNS)
      .order('created_at', { ascending: false });

    if (opts.actorEmail) query = query.eq('actor_email', opts.actorEmail);
    if (opts.action) query = query.eq('action', opts.action);
    if (opts.fromIso) query = query.gte('created_at', opts.fromIso);
    if (opts.toIso) query = query.lte('created_at', opts.toIso);

    const { data, error } = await query.limit(limit);


    if (error) {
      console.error('getActivity error:', error);
      return [];
    }
    return (data ?? []).map(mapRow);
  },

  /**
   * Distinct actor emails + action types across the WHOLE audit_log, so the
   * Activity filters can list every user/action since the beginning of history
   * (not just what is currently loaded). Falls back to an empty result when the
   * `activity_filter_options` RPC (migration 012) isn't applied yet — the page
   * then derives options from loaded rows.
   */
  async getFilterOptions(): Promise<{ actors: string[]; actions: string[] }> {
    const supabase = getSupabaseClient();
    if (!supabase) return { actors: [], actions: [] };
    try {
      const { data, error } = await supabase.rpc('activity_filter_options' as never);

      if (error || !data) return { actors: [], actions: [] };
      const d = data as { actors?: string[]; actions?: string[] };
      return { actors: d.actors ?? [], actions: d.actions ?? [] };
    } catch (e) {
      console.error('getFilterOptions error:', e);
      return { actors: [], actions: [] };
    }
  },


  /** Fetch a single activity entry by id (for the details page). */
  async getActivityById(id: number): Promise<ActivityEntry | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('audit_log')
      .select(ACTIVITY_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('getActivityById error:', error);
      return null;
    }
    return data ? mapRow(data) : null;
  },

  /**
   * Recent activity from the same user (by actor_id, falling back to email).
   * `excludeId` skips the activity currently being viewed.
   */
  async getUserActivity(actor: ActorRef, limit = 15, excludeId?: number): Promise<ActivityEntry[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    if (!actor.actorId && !actor.actorEmail) return [];

    let query = supabase.from('audit_log').select(ACTIVITY_COLUMNS);
    query = actor.actorId
      ? query.eq('actor_id', actor.actorId)
      : query.eq('actor_email', actor.actorEmail as string);
    if (excludeId != null) query = query.neq('id', excludeId);

    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) {
      console.error('getUserActivity error:', error);
      return [];
    }
    return (data ?? []).map(mapRow);
  },

  /** Chronological history of every change on the same entity (record). */
  async getEntityHistory(entityType: string, entityId: string, limit = 50): Promise<ActivityEntry[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('audit_log')
      .select(ACTIVITY_COLUMNS)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('getEntityHistory error:', error);
      return [];
    }
    return (data ?? []).map(mapRow);
  },

  /** Aggregated counters (today / this week / total + first & last activity). */
  async getUserActivityStats(actor: ActorRef): Promise<UserActivityStats> {
    const empty: UserActivityStats = { today: 0, week: 0, total: 0, firstAt: null, lastAt: null };
    const supabase = getSupabaseClient();
    if (!supabase || (!actor.actorId && !actor.actorEmail)) return empty;

    // Apply the actor filter (by id when present, otherwise email) to any builder.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withActor = (q: any) =>
      actor.actorId ? q.eq('actor_id', actor.actorId) : q.eq('actor_email', actor.actorEmail);

    const countQuery = () =>
      withActor(supabase.from('audit_log').select('id', { count: 'exact', head: true }));
    const tsQuery = () => withActor(supabase.from('audit_log').select('created_at'));

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const [todayRes, weekRes, totalRes, firstRes, lastRes] = await Promise.all([
        countQuery().gte('created_at', startOfToday),
        countQuery().gte('created_at', startOfWeek),
        countQuery(),
        tsQuery().order('created_at', { ascending: true }).limit(1),
        tsQuery().order('created_at', { ascending: false }).limit(1),
      ]);

      return {
        today: todayRes.count ?? 0,
        week: weekRes.count ?? 0,
        total: totalRes.count ?? 0,
        firstAt: firstRes.data?.[0]?.created_at ?? null,
        lastAt: lastRes.data?.[0]?.created_at ?? null,
      };
    } catch (e) {
      console.error('getUserActivityStats error:', e);
      return empty;
    }
  },


  /** Limited public profile of an actor (role / email / created_at). */
  async getActorProfile(actorId: string): Promise<ActorProfile | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.rpc('get_actor_profile', { p_actor_id: actorId } as never);
      if (error) {
        console.error('getActorProfile error:', error);
        return null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = Array.isArray(data) ? (data[0] as any) : (data as any);
      if (!row) return null;
      return {
        id: row.id,
        email: row.email ?? null,
        role: row.role ?? 'user',
        createdAt: row.created_at,
      };
    } catch (e) {
      console.error('getActorProfile error:', e);
      return null;
    }
  },

  /**
   * Best-effort client-side activity log. Calls the server `log_audit` RPC, which
   * stamps the current user id + email automatically. We additionally attach the
   * collected client audit-context (device / session / source / ip / geo). Never
   * throws — logging must never break the action that triggered it.
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
      let context: Record<string, unknown> = {};
      try {
        context = (await getAuditContext()) as unknown as Record<string, unknown>;
      } catch {
        /* context is optional — proceed without it */
      }

      const base = {
        p_action: action,
        p_entity_type: entityType,
        p_entity_id: entityId ?? undefined,
        p_metadata: metadata ?? {},
      };

      // Preferred call includes the audit context (migration 007).
      const { error } = await supabase.rpc('log_audit', { ...base, p_context: context } as never);

      // Backward-compat fallback: if migration 007 isn't applied yet, the 5-arg
      // signature won't exist — retry with the original 4-arg call so logging
      // keeps working everywhere.
      if (error) {
        await supabase.rpc('log_audit', base as never);
      }
    } catch (e) {
      console.error('logActivity error:', e);
    }
  },

};
