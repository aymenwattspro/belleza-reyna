'use client';

import React, { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Activity, User, Clock, History, ShieldCheck, Database,
  GitCompare, Layers, FileText,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  activityRepo, ActivityEntry, ActorProfile, UserActivityStats,
} from '@/lib/supabase/repos/activity-repo';
import {
  describe, userColor, initials, useActivityLabel, ChangeDetails,
} from '@/components/activity/shared';
import {
  SectionCard, InfoRow, FieldDiff, TechnicalInfo, AuditMetadata,
  SecurityAnalysis, UserInvestigation, HistoryRow, EntityTimeline,
  LocationBlock, useDf,
} from '@/components/activity/detail-sections';
import {
  ActivityDetailSkeleton, SectionSkeleton, HistoryListSkeleton,
} from '@/components/activity/skeletons';

export default function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const activityId = Number(id);

  const router = useRouter();
  const { t } = useLanguage();
  const df = useDf();
  const labelOf = useActivityLabel();

  // ── Primary entry ───────────────────────────────────────────────────────────
  const [entry, setEntry] = useState<ActivityEntry | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // ── Secondary (progressively loaded) data ────────────────────────────────────
  const [userHistory, setUserHistory] = useState<ActivityEntry[]>([]);
  const [entityHistory, setEntityHistory] = useState<ActivityEntry[]>([]);
  const [profile, setProfile] = useState<ActorProfile | null>(null);
  const [stats, setStats] = useState<UserActivityStats | null>(null);
  const [loadingSecondary, setLoadingSecondary] = useState(true);

  // Load the activity itself.
  useEffect(() => {
    let active = true;
    if (!Number.isFinite(activityId)) {
      setNotFound(true);
      setLoadingEntry(false);
      return;
    }
    (async () => {
      setLoadingEntry(true);
      const data = await activityRepo.getActivityById(activityId);
      if (!active) return;
      if (!data) setNotFound(true);
      setEntry(data);
      setLoadingEntry(false);
    })();
    return () => { active = false; };
  }, [activityId]);

  // Once the entry is known, load the related data in parallel.
  useEffect(() => {
    if (!entry) return;
    let active = true;
    setLoadingSecondary(true);

    const actorRef = { actorId: entry.actorId, actorEmail: entry.actorEmail };

    (async () => {
      const [history, ents, prof, st] = await Promise.all([
        activityRepo.getUserActivity(actorRef, 12, entry.id),
        entry.entityId
          ? activityRepo.getEntityHistory(entry.entityType, entry.entityId, 40)
          : Promise.resolve([] as ActivityEntry[]),
        entry.actorId ? activityRepo.getActorProfile(entry.actorId) : Promise.resolve(null),
        activityRepo.getUserActivityStats(actorRef),
      ]);
      if (!active) return;
      setUserHistory(history);
      setEntityHistory(ents);
      setProfile(prof);
      setStats(st);
      setLoadingSecondary(false);
    })();

    return () => { active = false; };
  }, [entry]);

  // ── Render: loading / not found ──────────────────────────────────────────────
  if (loadingEntry) return <ActivityDetailSkeleton />;

  if (notFound || !entry) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <button
          onClick={() => router.push('/activity')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-600 mb-8 transition-colors"
        >
          <ArrowLeft size={16} /> {t('act_back_to_activity')}
        </button>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Activity size={44} className="text-gray-300 mb-3" />
          <h3 className="text-lg font-semibold text-gray-500 mb-1">{t('act_not_found')}</h3>
          <p className="text-sm text-gray-400">{t('act_not_found_sub')}</p>
        </div>
      </div>
    );
  }

  const { Icon, color } = describe(entry);
  const uc = userColor(entry.actorEmail);
  const when = new Date(entry.createdAt);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5 sticky top-0 z-20">
        <button
          onClick={() => router.push('/activity')}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-indigo-600 mb-3 transition-colors"
        >
          <ArrowLeft size={13} /> {t('act_back_to_activity')}
        </button>
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
            <Icon size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 truncate">{labelOf(entry)}</h1>
            <p className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-mono text-gray-400">#{entry.id}</span>
              <span>·</span>
              <span>{entry.entityType}</span>
              <span>·</span>
              <span title={df.exact(when)}>{df.rel(when)}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Left column ── */}
        <div className="lg:col-span-2 space-y-5">
          {/* Overview */}
          <SectionCard title={t('act_overview')} icon={Activity}>
            <div className="space-y-0.5">
              <InfoRow label={t('act_user')}>
                <span className="inline-flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${uc.avatar}`}>
                    {initials(entry.actorEmail)}
                  </span>
                  <span className={uc.name}>{entry.actorEmail ?? t('act_unknown_user')}</span>
                  {profile?.role && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{profile.role}</span>
                  )}
                </span>
              </InfoRow>
              <InfoRow label={t('act_action')}>
                <span className="inline-flex items-center gap-2">
                  {labelOf(entry)}
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">{entry.action}</span>
                </span>
              </InfoRow>
              {entry.entityId && (
                <InfoRow label={t('act_entity_affected')} mono>{entry.entityId}</InfoRow>
              )}
              <InfoRow label={t('act_exact_time')}>{df.exact(when)}</InfoRow>
              <InfoRow label={t('act_relative_time')}>{df.rel(when)}</InfoRow>
              <InfoRow label={t('act_location')}><LocationBlock entry={entry} /></InfoRow>
            </div>
          </SectionCard>

          {/* Change Summary */}
          <SectionCard title={t('act_change_summary')} icon={FileText}>
            <ChangeSummary entry={entry} />
          </SectionCard>

          {/* Field Diff */}
          <SectionCard title={t('act_field_diff')} icon={GitCompare}>
            <FieldDiff metadata={entry.metadata} />
          </SectionCard>

          {/* Entity History */}
          {entry.entityId && (
            <SectionCard title={t('act_entity_history')} icon={Layers}>
              {loadingSecondary ? (
                <HistoryListSkeleton rows={4} />
              ) : (
                <EntityTimeline entries={entityHistory} currentId={entry.id} />
              )}
            </SectionCard>
          )}
        </div>

        {/* ── Right column ── */}
        <div className="space-y-5">
          {/* Technical Information */}
          <SectionCard title={t('act_technical_info')} icon={Database}>
            <TechnicalInfo entry={entry} />
          </SectionCard>

          {/* Security Analysis */}
          <SectionCard title={t('act_security_analysis')} icon={ShieldCheck}>
            {loadingSecondary ? (
              <SectionSkeleton lines={3} title={false} />
            ) : (
              <SecurityAnalysis entry={entry} history={userHistory} />
            )}
          </SectionCard>

          {/* User Investigation */}
          <SectionCard title={t('act_user_investigation')} icon={User}>
            {loadingSecondary ? (
              <SectionSkeleton lines={4} title={false} />
            ) : (
              <UserInvestigation actorEmail={entry.actorEmail} profile={profile} stats={stats} />
            )}
          </SectionCard>

          {/* User Activity History */}
          <SectionCard
            title={t('act_user_history')}
            icon={History}
            action={
              <span className="text-[11px] text-gray-300 inline-flex items-center gap-1">
                <Clock size={11} /> {t('act_recent_actions')}
              </span>
            }
          >
            {loadingSecondary ? (
              <HistoryListSkeleton rows={5} />
            ) : userHistory.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">{t('act_no_user_history')}</p>
            ) : (
              <div className="space-y-2">
                {userHistory.map((e) => (
                  <HistoryRow key={e.id} entry={e} />
                ))}
              </div>
            )}
          </SectionCard>

          {/* Audit Metadata */}
          <SectionCard title={t('act_audit_metadata')} icon={Layers}>
            <AuditMetadata entry={entry} />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/** Change Summary — structured chips/added/removed, or an honest empty state. */
function ChangeSummary({ entry }: { entry: ActivityEntry }) {
  const { t } = useLanguage();
  const m = entry.metadata ?? {};
  const hasContent = m && Object.keys(m).length > 0;

  if (!hasContent) {
    return <p className="text-sm text-gray-400 text-center py-2">{t('act_no_change_summary')}</p>;
  }
  return (
    <div>
      <ChangeDetails metadata={m} />
    </div>
  );
}
