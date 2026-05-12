'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff, Lock, Mail, User, ArrowRight, UserPlus, LogIn } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

type Tab = 'signin' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const { t, lang, setLang } = useLanguage();
  const { signIn, signUp, signOut, user, loading: authLoading, approved, notConfigured } = useAuth();

  const [tab, setTab] = useState<Tab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Only redirect when the user is BOTH authenticated AND approved by admin
  useEffect(() => {
    if (!authLoading && user && approved) {
      router.replace('/inventory-hub');
    }
  }, [user, authLoading, approved, router]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const err = await signIn(email.trim(), password);
    if (err) {
      setError(err.message);
    }
    // Redirect is handled by the useEffect above (fires after approval check completes)
    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (password !== confirmPassword) {
      setError(t('signup_pw_mismatch'));
      return;
    }
    if (password.length < 6) {
      setError(t('signup_pw_short'));
      return;
    }
    setLoading(true);
    const err = await signUp(email.trim(), password, fullName.trim());
    if (err) {
      setError(err.message);
    } else {
      setSuccess(t('signup_success'));
      setTab('signin');
    }
    setLoading(false);
  };

  const clearForm = () => {
    setEmail(''); setPassword(''); setFullName(''); setConfirmPassword('');
    setError(''); setSuccess('');
  };

  // Language toggle button — reused in multiple places
  const LangToggle = () => (
    <div className="absolute top-4 right-4 z-10">
      <button
        onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
        className="flex items-center gap-2 px-3 py-1.5 bg-white/80 backdrop-blur-sm border border-pink-100 rounded-full text-xs font-semibold text-pink-600 hover:bg-white hover:shadow-sm transition-all"
      >
        {lang === 'en' ? '🇲🇽 Español' : '🇺🇸 English'}
      </button>
    </div>
  );

  // ── Loading spinner ─────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-fuchsia-50 relative">
        <LangToggle />
        <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Pending approval (signed in but not yet approved) ───────────────────────
  if (user && !approved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50 px-4 relative">
        <LangToggle />
        <div className="w-full max-w-sm text-center bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-pink-200/40 border border-pink-100/50 p-10 space-y-5">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-100 to-fuchsia-100 flex items-center justify-center text-3xl shadow-inner">
              ⏳
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-gray-800">{t('pending_title')}</h2>
            <p className="text-sm text-gray-500 leading-relaxed">{t('pending_subtitle')}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 font-medium text-left space-y-1">
            <p className="font-semibold">{t('pending_signed_as')}:</p>
            <p className="font-mono break-all text-amber-800">{user.email}</p>
          </div>
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

  // ── Login / Sign-up form ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50 flex flex-col">
      <LangToggle />

      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-pink-200/40 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-rose-200/40 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-fuchsia-100/30 rounded-full blur-2xl" />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 relative z-10">
        <div className="w-full max-w-sm">
          {/* Card */}
          <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-pink-200/40 border border-pink-100/50 overflow-hidden">

            {/* Brand header — logo shown directly, no container */}
            <div className="bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 px-8 py-8 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(255,255,255,0.15),transparent_60%)]" />
              <div className="relative mb-3 flex justify-center">
                <Image
                  src="/logoreyna.png"
                  alt="Belleza Reyna"
                  width={80}
                  height={80}
                  className="object-contain drop-shadow-2xl"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
              <h1 className="text-xl font-bold text-white tracking-tight">Belleza Reyna</h1>
              <p className="text-pink-200 text-xs mt-0.5 font-medium">{t('brand_tagline')}</p>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100">
              {(['signin', 'signup'] as Tab[]).map((tabKey) => (
                <button
                  key={tabKey}
                  onClick={() => { setTab(tabKey); clearForm(); }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition-all',
                    tab === tabKey
                      ? 'text-pink-600 border-b-2 border-pink-500 bg-pink-50/50'
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                  )}
                >
                  {tabKey === 'signin' ? <LogIn size={14} /> : <UserPlus size={14} />}
                  {tabKey === 'signin' ? t('signin_tab') : t('signup_tab')}
                </button>
              ))}
            </div>

            {/* Form body */}
            <div className="px-7 py-6">
              {/* Misconfiguration banner */}
              {notConfigured && (
                <div className="mb-4 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-xs text-amber-800 font-medium space-y-1">
                  <p className="font-bold">⚠️ Supabase not configured</p>
                  <p>Set these in <strong>Vercel → Settings → Environment Variables</strong>:</p>
                  <p className="font-mono break-all">NEXT_PUBLIC_SUPABASE_URL</p>
                  <p className="font-mono break-all">NEXT_PUBLIC_SUPABASE_ANON_KEY</p>
                  <p className="mt-1">URL format: <span className="font-mono">https://&lt;project-id&gt;.supabase.co</span></p>
                </div>
              )}

              {/* Success banner */}
              {success && (
                <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-700 font-medium">
                  {success}
                </div>
              )}

              {/* ── SIGN IN form ── */}
              {tab === 'signin' && (
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('signup_email')}
                    </label>
                    <div className="relative">
                      <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none text-sm transition-all bg-gray-50 focus:bg-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('login_password')}
                    </label>
                    <div className="relative">
                      <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        required
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none text-sm transition-all bg-gray-50 focus:bg-white"
                      />
                      <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-600 font-medium">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !email || !password}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-rose-500 via-pink-500 to-fuchsia-500 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-pink-300/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm mt-1"
                  >
                    {loading ? (
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>{t('enter')} <ArrowRight size={14} /></>
                    )}
                  </button>
                </form>
              )}

              {/* ── SIGN UP form ── */}
              {tab === 'signup' && (
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('signup_full_name')}
                    </label>
                    <div className="relative">
                      <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={t('signup_name_placeholder')}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none text-sm transition-all bg-gray-50 focus:bg-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('signup_email')}
                    </label>
                    <div className="relative">
                      <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none text-sm transition-all bg-gray-50 focus:bg-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('login_password')}
                    </label>
                    <div className="relative">
                      <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('signup_pw_placeholder')}
                        autoComplete="new-password"
                        required
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none text-sm transition-all bg-gray-50 focus:bg-white"
                      />
                      <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('signup_confirm_pw')}
                    </label>
                    <div className="relative">
                      <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={t('signup_pw_repeat')}
                        autoComplete="new-password"
                        required
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none text-sm transition-all bg-gray-50 focus:bg-white"
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-600 font-medium">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !email || !password || !confirmPassword}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-rose-500 via-pink-500 to-fuchsia-500 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-pink-300/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm mt-1"
                  >
                    {loading ? (
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>{t('create_account')} <ArrowRight size={14} /></>
                    )}
                  </button>

                  <p className="text-center text-[11px] text-gray-400 pt-1">
                    {t('signup_team_note')}
                  </p>
                </form>
              )}
            </div>
          </div>

          <p className="text-center text-xs text-gray-400 mt-5">
            © {new Date().getFullYear()} Belleza Reyna · Powered by Supabase
          </p>
        </div>
      </div>
    </div>
  );
}
