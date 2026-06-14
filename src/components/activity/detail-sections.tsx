'use client';

/**
 * Building blocks for the Activity Details page (`/activity/[id]`).
 *
 * Each section is a small, focused, presentational component so the page itself
 * stays declarative. Everything degrades gracefully: when a piece of audit data
 * was never recorded we show an honest "not recorded" state instead of inventing
 * values.
 */

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Monitor, Globe, Hash, Database, ShieldCheck, ShieldAlert, MapPin,
  Fingerprint, ArrowRight, ChevronRight, Mail, Server, Smartphone,
  AlertTriangle, Clock, UserCog,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ActivityEntry, ActorProfile, UserActivityStats } from '@/lib/supabase/repos/activity-repo';
import { describeDevice, describeLocation } from '@/lib/audit/context';
import { describe, userColor, initials, useActivityLabel } from './shared';

// ── Small atoms ───────────────────────────────────────────────────────────────
export function SectionCard({
  title, icon: Icon, children, action, className = '',
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${className}`}>
      <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-100">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Icon size={15} className="text-gray-400" />
          {title}
        </h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function InfoRow({
  label, children, mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm text-gray-800 text-right break-words min-w-0 ${mono ? 'font-mono text-xs' : ''}`}>
        {children}
      </span>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-6">
      <p className="text-sm text-gray-400">{title}</p>
      {hint && <p className="text-xs text-gray-300 mt-1">{hint}</p>}
    </div>
  );
}

// ── Date helpers (locale-aware) ──────────────────────────────────────────────
export function useDf() {
  const { lang } = useLanguage();
  const locale = lang === 'es' ? { locale: es } : undefined;
  return {
    exact: (d: string | Date) => format(new Date(d), 'dd MMM yyyy · HH:mm:ss', locale),
    short: (d: string | Date) => format(new Date(d), 'dd MMM HH:mm', locale),
    time: (d: string | Date) => format(new Date(d), 'HH:mm', locale),
    rel: (d: string | Date) => formatDistanceToNow(new Date(d), { addSuffix: true, ...locale }),
  };
}

// ── Field Diff viewer (before / after) ───────────────────────────────────────
type DiffRow = { field: string; before: React.ReactNode; after: React.ReactNode };

function toDisplay(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Derive before/after rows from whatever change metadata exists. */
function buildDiffRows(metadata: Record<string, unknown>): DiffRow[] {
  const rows: DiffRow[] = [];
  const m = metadata ?? {};

  // 1) renamed: { from, to }
  const renamed = m.renamed as { from?: unknown; to?: unknown } | undefined;
  if (renamed && (renamed.from != null || renamed.to != null)) {
    rows.push({ field: 'name', before: toDisplay(renamed.from), after: toDisplay(renamed.to) });
  }

  // 2) generic changes: [{ field, from/before, to/after }]
  const changes = m.changes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(changes)) {
    for (const c of changes) {
      const field = String(c.field ?? c.key ?? c.name ?? '');
      if (!field) continue;
      rows.push({
        field,
        before: toDisplay(c.from ?? c.before ?? c.old),
        after: toDisplay(c.to ?? c.after ?? c.new),
      });
    }
  }

  // 3) before/after object pair → diff changed keys
  const before = m.before as Record<string, unknown> | undefined;
  const after = m.after as Record<string, unknown> | undefined;
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
        rows.push({ field: k, before: toDisplay(before[k]), after: toDisplay(after[k]) });
      }
    }
  }

  // 4) quantity changes: [{ ref, name, from, to }]
  const qty = m.qty_changes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(qty)) {
    for (const q of qty) {
      const field = String(q.name ?? q.ref ?? '');
      if (!field) continue;
      rows.push({ field, before: toDisplay(q.from), after: toDisplay(q.to) });
    }
  }

  return rows;
}

export function FieldDiff({ metadata }: { metadata: Record<string, unknown> }) {
  const { t } = useLanguage();
  const rows = useMemo(() => buildDiffRows(metadata), [metadata]);

  if (rows.length === 0) return <EmptyState title={t('act_no_changes')} />;

  return (
    <div className="space-y-3">
      {rows.slice(0, 40).map((r, i) => (
        <div key={r.field + i} className="rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 text-xs font-semibold text-gray-600 truncate">{r.field}</div>
          <div className="divide-y divide-gray-50">
            <div className="flex items-start gap-2 px-3 py-1.5 bg-red-50/50">
              <span className="text-red-400 font-mono text-xs mt-0.5">−</span>
              <span className="text-sm text-red-700 line-through/0 break-words min-w-0">{r.before}</span>
            </div>
            <div className="flex items-start gap-2 px-3 py-1.5 bg-emerald-50/50">
              <span className="text-emerald-500 font-mono text-xs mt-0.5">+</span>
              <span className="text-sm text-emerald-700 font-medium break-words min-w-0">{r.after}</span>
            </div>
          </div>
        </div>
      ))}
      {rows.length > 40 && <p className="text-xs text-gray-400 text-center">+{rows.length - 40}…</p>}
    </div>
  );
}

// ── Technical Information ────────────────────────────────────────────────────
export function TechnicalInfo({ entry }: { entry: ActivityEntry }) {
  const { t } = useLanguage();
  const device = entry.device;
  const geo = entry.geo;

  const hasAny =
    entry.ipAddress || entry.userAgent || entry.sessionId || entry.source ||
    (device && (device.browser || device.os || device.deviceType));

  if (!hasAny) {
    return <EmptyState title={t('act_no_tech_info')} hint={t('act_no_tech_hint')} />;
  }

  const deviceLabel = describeDevice(device);

  return (
    <div className="space-y-0.5">
      {entry.source && <InfoRow label={t('act_source')}>{entry.source}</InfoRow>}
      {entry.ipAddress && <InfoRow label={t('act_ip')} mono>{entry.ipAddress}</InfoRow>}
      {device?.browser && (
        <InfoRow label={t('act_browser')}>
          {device.browser}{device.browserVersion ? ` ${device.browserVersion}` : ''}
        </InfoRow>
      )}
      {device?.os && (
        <InfoRow label={t('act_os')}>
          {device.os}{device.osVersion ? ` ${device.osVersion}` : ''}
        </InfoRow>
      )}
      {device?.deviceType && (
        <InfoRow label={t('act_device_type')}>
          <span className="capitalize">{device.deviceType}</span>
        </InfoRow>
      )}
      {!device && deviceLabel && <InfoRow label={t('act_device')}>{deviceLabel}</InfoRow>}
      {geo?.timezone && <InfoRow label={t('act_timezone')}>{geo.timezone}</InfoRow>}
      {entry.sessionId && <InfoRow label={t('act_session')} mono>{entry.sessionId}</InfoRow>}
      {entry.userAgent && (
        <InfoRow label={t('act_user_agent')} mono>
          <span className="text-gray-400 break-all">{entry.userAgent}</span>
        </InfoRow>
      )}
    </div>
  );
}

// ── Location block (Overview) ────────────────────────────────────────────────
export function LocationBlock({ entry }: { entry: ActivityEntry }) {
  const { t } = useLanguage();
  const geo = entry.geo;
  const line = describeLocation(geo);
  const hasLocation = line || entry.ipAddress || geo?.timezone;

  if (!hasLocation) {
    return <span className="text-gray-400">{t('act_not_recorded')}</span>;
  }

  return (
    <div className="text-right">
      {line && <p className="text-sm text-gray-800">{line}</p>}
      {geo?.timezone && <p className="text-[11px] text-gray-400">{geo.timezone}</p>}
      {entry.ipAddress && <p className="text-[11px] text-gray-300 font-mono">{entry.ipAddress}</p>}
    </div>
  );
}

// ── Audit Metadata (raw, technical) ──────────────────────────────────────────
export function AuditMetadata({ entry }: { entry: ActivityEntry }) {
  const { t } = useLanguage();
  const df = useDf();

  return (
    <div className="space-y-0.5">
      <InfoRow label={t('act_activity_id')} mono>{entry.id}</InfoRow>
      {entry.requestId && <InfoRow label={t('act_request_id')} mono>{entry.requestId}</InfoRow>}
      {entry.sessionId && <InfoRow label={t('act_session')} mono>{entry.sessionId}</InfoRow>}
      <InfoRow label={t('act_entity')}>{entry.entityType}</InfoRow>
      {entry.entityId && <InfoRow label="entity_id" mono>{entry.entityId}</InfoRow>}
      {entry.actorId && <InfoRow label="actor_id" mono>{entry.actorId}</InfoRow>}
      <InfoRow label={t('act_source')}>{entry.source ?? t('act_not_recorded')}</InfoRow>
      <InfoRow label={t('act_created')}>{df.exact(entry.createdAt)}</InfoRow>
    </div>
  );
}

// ── Security Analysis ────────────────────────────────────────────────────────
type Severity = 'low' | 'medium' | 'high';
type RiskSignal = { key: string; labelKey: string; severity: Severity };
type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'insufficient';

export function computeRisk(entry: ActivityEntry, history: ActivityEntry[]): {
  level: RiskLevel;
  signals: RiskSignal[];
} {
  const device = entry.device;
  const geo = entry.geo;

  // No audit context on this record → we cannot assess (don't fabricate).
  const hasContext = !!(device || geo || entry.ipAddress || entry.sessionId);
  if (!hasContext) return { level: 'insufficient', signals: [] };

  // Only compare against history rows that actually carry audit context.
  const priors = history.filter((h) => h.device || h.geo || h.ipAddress);

  const signals: RiskSignal[] = [];

  if (priors.length > 0) {
    const browsers = new Set(priors.map((h) => h.device?.browser).filter(Boolean));
    const oses = new Set(priors.map((h) => h.device?.os).filter(Boolean));
    const devices = new Set(priors.map((h) => h.device?.deviceType).filter(Boolean));
    const countries = new Set(priors.map((h) => h.geo?.country).filter(Boolean));
    const cities = new Set(priors.map((h) => h.geo?.city).filter(Boolean));

    if (device?.browser && browsers.size > 0 && !browsers.has(device.browser)) {
      signals.push({ key: 'browser', labelKey: 'act_signal_new_browser', severity: 'medium' });
    }
    if (device?.os && oses.size > 0 && !oses.has(device.os)) {
      signals.push({ key: 'os', labelKey: 'act_signal_new_os', severity: 'medium' });
    }
    if (device?.deviceType && devices.size > 0 && !devices.has(device.deviceType)) {
      signals.push({ key: 'device', labelKey: 'act_signal_new_device', severity: 'medium' });
    }
    if (geo?.country && countries.size > 0 && !countries.has(geo.country)) {
      signals.push({ key: 'country', labelKey: 'act_signal_new_country', severity: 'high' });
    }
    if (geo?.city && cities.size > 0 && !cities.has(geo.city)) {
      signals.push({ key: 'city', labelKey: 'act_signal_new_city', severity: 'low' });
    }
  }

  // Rapid modifications: many events from this actor within a 2-minute window.
  const t0 = new Date(entry.createdAt).getTime();
  const near = history.filter((h) => Math.abs(new Date(h.createdAt).getTime() - t0) <= 2 * 60 * 1000);
  if (near.length >= 5) {
    signals.push({ key: 'rapid', labelKey: 'act_signal_rapid', severity: 'medium' });
  }

  // Score → level
  const score = signals.reduce((s, sig) => s + (sig.severity === 'high' ? 3 : sig.severity === 'medium' ? 2 : 1), 0);
  let level: RiskLevel = 'none';
  if (score >= 5) level = 'high';
  else if (score >= 3) level = 'medium';
  else if (score >= 1) level = 'low';

  return { level, signals };
}

export function SecurityAnalysis({ entry, history }: { entry: ActivityEntry; history: ActivityEntry[] }) {
  const { t } = useLanguage();
  const { level, signals } = useMemo(() => computeRisk(entry, history), [entry, history]);

  const levelStyles: Record<Exclude<RiskLevel, 'insufficient'>, string> = {
    none: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    high: 'bg-red-50 text-red-700 border-red-200',
  };
  const levelLabel: Record<Exclude<RiskLevel, 'insufficient'>, string> = {
    none: t('act_risk_low'),
    low: t('act_risk_low'),
    medium: t('act_risk_medium'),
    high: t('act_risk_high'),
  };

  if (level === 'insufficient') {
    return <EmptyState title={t('act_risk_insufficient')} />;
  }

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between rounded-xl border px-3 py-2 ${levelStyles[level]}`}>
        <span className="flex items-center gap-2 text-sm font-medium">
          {level === 'high' || level === 'medium'
            ? <ShieldAlert size={15} />
            : <ShieldCheck size={15} />}
          {t('act_risk_level')}
        </span>
        <span className="text-sm font-bold">{levelLabel[level]}</span>
      </div>

      {signals.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-emerald-600">
          <ShieldCheck size={15} /> {t('act_risk_none')}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {signals.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-sm text-gray-700">
              <AlertTriangle
                size={14}
                className={s.severity === 'high' ? 'text-red-500' : s.severity === 'medium' ? 'text-amber-500' : 'text-gray-400'}
              />
              {t(s.labelKey as never)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── User Investigation ───────────────────────────────────────────────────────
export function UserInvestigation({
  actorEmail, profile, stats,
}: {
  actorEmail: string | null;
  profile: ActorProfile | null;
  stats: UserActivityStats | null;
}) {
  const { t } = useLanguage();
  const df = useDf();
  const uc = userColor(actorEmail);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold ${uc.avatar}`}>
          {initials(actorEmail)}
        </span>
        <div className="min-w-0">
          <p className={`text-sm font-semibold truncate ${uc.name}`}>{actorEmail ?? t('act_not_recorded')}</p>
          <p className="flex items-center gap-1.5 text-xs text-gray-400">
            <UserCog size={12} /> {profile?.role ?? '—'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat value={stats?.today ?? 0} label={t('act_actions_today')} />
        <Stat value={stats?.week ?? 0} label={t('act_actions_week')} />
        <Stat value={stats?.total ?? 0} label={t('act_total_actions')} />
      </div>

      <div className="space-y-0.5">
        {profile?.createdAt && <InfoRow label={t('act_account_created')}>{df.short(profile.createdAt)}</InfoRow>}
        {stats?.lastAt && <InfoRow label={t('act_last_seen')}>{df.rel(stats.lastAt)}</InfoRow>}
        {profile?.email && (
          <InfoRow label={t('act_email')}>
            <span className="inline-flex items-center gap-1"><Mail size={12} className="text-gray-300" />{profile.email}</span>
          </InfoRow>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-gray-50 py-2">
      <p className="text-lg font-bold text-gray-800 tabular-nums">{value}</p>
      <p className="text-[10px] text-gray-400 leading-tight">{label}</p>
    </div>
  );
}

// ── Clickable history row (user history + entity history) ────────────────────
export function HistoryRow({ entry, active = false }: { entry: ActivityEntry; active?: boolean }) {
  const router = useRouter();
  const df = useDf();
  const label = useActivityLabel()(entry);
  const { Icon, color } = describe(entry);

  return (
    <button
      type="button"
      onClick={() => router.push(`/activity/${entry.id}`)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all duration-200
        hover:border-gray-200 hover:bg-gray-50 hover:shadow-sm active:scale-[0.99]
        ${active ? 'border-indigo-200 bg-indigo-50/40' : 'border-gray-100'}`}
    >
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon size={13} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-800 truncate">{label}</span>
        <span className="block text-[11px] text-gray-400 truncate">
          {entry.entityType}{entry.entityId ? ` · ${entry.entityId}` : ''}
        </span>
      </span>
      <span className="text-[11px] text-gray-400 shrink-0">{df.short(entry.createdAt)}</span>
      <ChevronRight size={14} className="text-gray-300 shrink-0" />
    </button>
  );
}

// ── Entity timeline (compact vertical timeline) ──────────────────────────────
export function EntityTimeline({ entries, currentId }: { entries: ActivityEntry[]; currentId: number }) {
  const { t } = useLanguage();
  const df = useDf();
  const label = useActivityLabel();
  const router = useRouter();

  if (entries.length === 0) return <EmptyState title={t('act_no_entity_history')} />;

  return (
    <ol className="relative pl-5 border-l-2 border-gray-100 space-y-3">
      {entries.map((e) => {
        const { Icon, color } = describe(e);
        const isCurrent = e.id === currentId;
        return (
          <li key={e.id} className="relative">
            <span className={`absolute -left-[26px] top-1 w-6 h-6 rounded-lg flex items-center justify-center ${color}`}>
              <Icon size={12} />
            </span>
            <button
              type="button"
              onClick={() => router.push(`/activity/${e.id}`)}
              className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors duration-200
                ${isCurrent ? 'bg-indigo-50/60 ring-1 ring-indigo-100' : 'hover:bg-gray-50'}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-800 truncate">{label(e)}</span>
                <span className="text-[11px] text-gray-400 shrink-0">{df.time(e.createdAt)}</span>
              </span>
              <span className="text-[11px] text-gray-400">{df.short(e.createdAt)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// Re-export icons used by the page for convenience.
export const DetailIcons = {
  Monitor, Globe, Hash, Database, ShieldCheck, MapPin, Fingerprint, ArrowRight, Server, Smartphone, Clock,
};
