'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { User, Session, AuthError, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  /** True while the initial auth + profile check is in progress. */
  loading: boolean;
  /** True when NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are not set / invalid. */
  notConfigured: boolean;
  /**
   * True when the profile row in public.profiles has is_approved = true.
   * Always re-fetched from the DB — never read from stale React state.
   */
  approved: boolean;
  signIn: (email: string, password: string) => Promise<AuthError | null>;
  signUp: (email: string, password: string, fullName?: string) => Promise<AuthError | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function forceLocalSignOut(supabase: SupabaseClient) {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Ignore — local clear works even if the network request fails
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [approved, setApproved] = useState(false);

  const configured = isSupabaseConfigured();
  const supabase   = configured ? getSupabaseClient() : null;

  // ── Fetch approval ────────────────────────────────────────────────────────────
  // Always queries public.profiles fresh from the DB using user.id.
  // Never relies on email, cached session data, or stale React state.
  const fetchApproval = useCallback(async (userId: string | null): Promise<boolean> => {
    if (!supabase || !userId) return false;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_approved')
        .eq('id', userId)
        .single();

      if (error) {
        // No profile row yet → user is pending (not approved). Don't sign out.
        return false;
      }
      return (data as { is_approved?: boolean })?.is_approved === true;
    } catch {
      return false;
    }
  }, [supabase]);

  // ── Poll approval every 5s while user is present but NOT yet approved ─────────
  useEffect(() => {
    if (!user || approved) return;
    const interval = setInterval(async () => {
      const result = await fetchApproval(user.id);
      setApproved(result);
    }, 5000);
    return () => clearInterval(interval);
  }, [user?.id, approved, fetchApproval]);

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Use getUser() to validate the session against the auth server (never stale).
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        setUser(user);
        const ok = await fetchApproval(user.id);
        setApproved(ok);
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    // Live auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) setLoading(true);
        setSession(session);

        if (session?.user) {
          setUser(session.user);
          // Always re-fetch profile from DB — never trust cached approval state.
          const ok = await fetchApproval(session.user.id);
          setApproved(ok);
        } else {
          setUser(null);
          setApproved(false);
        }

        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  // fetchApproval is stable (useCallback with supabase dep) — safe to include
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auth actions ─────────────────────────────────────────────────────────────

  const signIn = useCallback(async (
    email: string,
    password: string,
  ): Promise<AuthError | null> => {
    if (!supabase) return { name: 'AuthError', message: 'Supabase is not configured.' } as AuthError;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  }, [supabase]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName?: string,
  ): Promise<AuthError | null> => {
    if (!supabase) return { name: 'AuthError', message: 'Supabase is not configured.' } as AuthError;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName ?? '' } },
    });

    // Client-side fallback: INSERT (not upsert) profile if the DB trigger
    // didn't create it. Only when we have an immediate session (email
    // confirmation disabled). Uses INSERT so it NEVER overwrites existing rows.
    if (!error && data.user && data.session) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('profiles').insert({
          id: data.user.id,
          email: data.user.email ?? email,
          is_approved: false,
          role: 'user',
        });
      } catch {
        // Profile already exists from the trigger → ignore the conflict error
      }
    }

    return error;
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await forceLocalSignOut(supabase);
    setUser(null);
    setSession(null);
    setApproved(false);
  }, [supabase]);

  // ── Context value ─────────────────────────────────────────────────────────────

  const value = useMemo<AuthContextValue>(() => ({
    user,
    session,
    loading,
    notConfigured: !configured,
    approved,
    signIn,
    signUp,
    signOut,
  }), [user, session, loading, configured, approved, signIn, signUp, signOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
