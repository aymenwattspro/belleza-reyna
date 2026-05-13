'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Toaster } from 'sonner';
import { Sidebar } from './Sidebar';
import { ChatWidget } from '@/components/chatbot/ChatWidget';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

// ── Centralized access control ──────────────────────────────────────────────
// Single source of truth for redirect rules:
//   loading                    → show loader (never redirect mid-load)
//   no user                    → /login
//   profile.is_approved !== true → /pending
//   else                       → allow access to protected routes
//
// Rules also handle the inverse cases on /login and /pending so users
// who are already authenticated can't loop back to the wrong screen.
//
// IMPORTANT: This component does NOT call Supabase. It only reads
// `user`, `profile`, and `loading` from AuthContext.

const PUBLIC_PATHS = new Set(['/login', '/pending']);

const DEFAULT_LANDING = '/inventory-hub';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const { lang } = useLanguage();

  const isLoginPage   = pathname === '/login';
  const isPendingPage = pathname === '/pending';
  const isPublic      = PUBLIC_PATHS.has(pathname);
  const isApproved    = profile?.is_approved === true;

  useEffect(() => {
    // Never redirect while auth state is resolving — avoids flicker + loops.
    if (loading) return;

    // ── /login ── redirect away if already authenticated
    if (isLoginPage) {
      if (user && isApproved) {
        router.replace(DEFAULT_LANDING);
      } else if (user && !isApproved) {
        router.replace('/pending');
      }
      return;
    }

    // ── /pending ── redirect away if not signed-in or already approved
    if (isPendingPage) {
      if (!user) {
        router.replace('/login');
      } else if (isApproved) {
        router.replace(DEFAULT_LANDING);
      }
      return;
    }

    // ── Protected routes ──
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!isApproved) {
      router.replace('/pending');
      return;
    }
    // Otherwise: signed in AND approved → allow access (no redirect).
  }, [
    loading,
    user,
    isApproved,
    isLoginPage,
    isPendingPage,
    router,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Public paths (login, pending) render their own UI immediately.
  if (isPublic) {
    return (
      <>
        {children}
        <Toaster position="top-right" richColors expand closeButton />
      </>
    );
  }

  // Protected paths: gate render on loading + auth + approval.
  // We render the loader (NOT the children) until the redirect lands —
  // this prevents protected content from briefly flashing on screen.
  if (loading || !user || !isApproved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Authenticated + approved → full app shell
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 ml-64 min-h-screen">
        {/* key={lang} forces remount on language change so all useMemo'd
            translations refresh — guarantees 100% translation accuracy. */}
        <main key={lang} className="min-h-screen">{children}</main>
      </div>
      <ChatWidget />
      <Toaster position="top-right" richColors expand closeButton />
    </div>
  );
}
