'use client';

/**
 * Skeleton loaders for the Activity surfaces. Subtle `animate-pulse` placeholders
 * that mirror the real layout so the page doesn't shift when data arrives.
 */

import React from 'react';

function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded-md bg-gray-200/70 ${className}`} />;
}

/** Skeleton for the grouped activity list (used on /activity while loading). */
export function ActivityListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-8 animate-pulse" aria-hidden="true">
      {[0, 1].map((group) => (
        <div key={group}>
          <Bar className="h-3 w-32 mb-3" />
          <div className="relative pl-5 border-l-2 border-gray-100 space-y-3">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-[26px] top-3 w-7 h-7 rounded-lg bg-gray-200/70" />
                <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-gray-200 px-4 py-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md bg-gray-200/70" />
                        <Bar className="h-3 w-40" />
                      </div>
                      <Bar className="h-3.5 w-52" />
                      <Bar className="h-2.5 w-24" />
                    </div>
                    <div className="space-y-1.5">
                      <Bar className="h-2.5 w-10" />
                      <Bar className="h-2 w-14" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A generic card-section skeleton used inside the details page. */
export function SectionSkeleton({ lines = 4, title = true }: { lines?: number; title?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm animate-pulse" aria-hidden="true">
      {title && <Bar className="h-3 w-28 mb-4" />}
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Bar className="h-3 w-24" />
            <Bar className="h-3 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact rows skeleton for the user / entity history lists. */
export function HistoryListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100">
          <span className="w-7 h-7 rounded-lg bg-gray-200/70" />
          <div className="flex-1 space-y-1.5">
            <Bar className="h-3 w-44" />
            <Bar className="h-2.5 w-24" />
          </div>
          <Bar className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Full-page skeleton for the Activity Details route. */
export function ActivityDetailSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <Bar className="h-3 w-28 mb-4" />
        <div className="flex items-center gap-3 animate-pulse">
          <span className="w-11 h-11 rounded-xl bg-gray-200/70" />
          <div className="space-y-2">
            <Bar className="h-4 w-48" />
            <Bar className="h-3 w-32" />
          </div>
        </div>
      </div>
      <div className="p-6 max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <SectionSkeleton lines={5} />
          <SectionSkeleton lines={3} />
          <SectionSkeleton lines={4} />
        </div>
        <div className="space-y-5">
          <SectionSkeleton lines={4} />
          <SectionSkeleton lines={5} />
        </div>
      </div>
    </div>
  );
}
