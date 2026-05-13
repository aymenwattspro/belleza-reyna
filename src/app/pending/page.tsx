'use client';

import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

// ── /pending ───────────────────────────────────────────────────────────────
// Shown to users who are signed-in but whose profile.is_approved is false.
// AppLayout handles all redirect logic — this page only renders UI.
// Uses ONLY AuthContext + LanguageContext. No Supabase calls.

export default function PendingPage() {
  const { user, signOut } = useAuth();
  const { t, lang, setLang } = useLanguage();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50 px-4 relative">
      {/* Language toggle */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
          className="flex items-center gap-2 px-3 py-1.5 bg-white/80 backdrop-blur-sm border border-pink-100 rounded-full text-xs font-semibold text-pink-600 hover:bg-white hover:shadow-sm transition-all"
        >
          {lang === 'en' ? '🇲🇽 Español' : '🇺🇸 English'}
        </button>
      </div>

      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-pink-200/40 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-rose-200/40 rounded-full blur-3xl" />
      </div>

      {/* Card */}
      <div className="w-full max-w-sm text-center bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-pink-200/40 border border-pink-100/50 p-10 space-y-5 relative z-10">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-100 to-fuchsia-100 flex items-center justify-center text-3xl shadow-inner">
            ⏳
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-bold text-gray-800">{t('pending_title')}</h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            {t('pending_subtitle')}
          </p>
        </div>

        {user?.email && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 font-medium text-left space-y-1">
            <p className="font-semibold">{t('pending_signed_as')}:</p>
            <p className="font-mono break-all text-amber-800">{user.email}</p>
          </div>
        )}

        <button
          onClick={() => signOut()}
          className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all"
        >
          {t('logout')}
        </button>
      </div>
    </div>
  );
}
