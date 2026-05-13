'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
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
   * True when the cached profile row has is_approved = true.
   * Updated only on auth events (initial load, sign-in, sign-out).
   * Approval changes by admin are reflected on next sign-in.
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
    /* local clear works even if network request fails */
  }
}

/** Single profile fetch — by user.id only, never by email. */
async function fetchIsApproved(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('is_approved')
      .eq('id', userId)
      .single();

    if (error) return false; // No profile row = pending (don't sign out)
    return (data as { is_approved?: boolean } | null)?.is_approved === true;
  } catch {
    return false;
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]         = useState<User | null>(null);
  const [session, setSession]   = useState<Session | null>(null);
  const [loading, setLoading]   = useState(true);
  const [approved, setApproved] = useState(false);

  const configured = isSupabaseConfigured();

  // ── Stable Supabase client (never re-created across renders) ────────────────
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (configured && !supabaseRef.current) {
    supabaseRef.current = getSupabaseClient();
  }
  const supabase = supabaseRef.current;

  // ── Single bootstrap effect ─────────────────────────────────────────────────
  // Runs ONCE on mount. Sets up exactly one auth listener.
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    // 1) Initial check — getUser() validates against the auth server (never stale).
    //    Then ONE profile fetch using user.id.
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!isMounted) return;

      if (!authUser) {
        setLoading(false);
        return;
      }

      const { data: { session: authSession } } = await supabase.auth.getSession();
      const isApproved = await fetchIsApproved(supabase, authUser.id);
      if (!isMounted) return;

      setSession(authSession);
      setUser(authUser);
      setApproved(isApproved);
      setLoading(false);
    })().catch(() => {
      if (isMounted) setLoading(false);
    });

    // 2) Single auth listener — only reacts to SIGNED_IN / SIGNED_OUT.
    //    No polling, no intervals, no extra queries.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, nextSession) => {
        if (!isMounted) return;

        if (event === 'SIGNED_OUT') {
          setUser(null);
          setSession(null);
          setApproved(false);
          setLoading(false);
          return;
        }

        if (event === 'SIGNED_IN' && nextSession?.user) {
          setLoading(true);
          const isApproved = await fetchIsApproved(supabase, nextSession.user.id);
          if (!isMounted) return;
          setSession(nextSession);
          setUser(nextSession.user);
          setApproved(isApproved);
          setLoading(false);
        }
        // TOKEN_REFRESHED, INITIAL_SESSION, USER_UPDATED, PASSWORD_RECOVERY:
        // do NOTHING. We don't re-query the profile on token refresh — that
        // would cause repeated DB calls. Approval changes are picked up on
        // next sign-in.
      },
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
    // Empty deps — bootstrap runs exactly once for the lifetime of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auth actions ─────────────────────────────────────────────────────────────

  const signIn = useCallback(async (
    email: string,
    password: string,
  ): Promise<AuthError | null> => {
    if (!supabase) {
      return { name: 'AuthError', message: 'Supabase is not configured.' } as AuthError;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // No manual state update — onAuthStateChange will fire SIGNED_IN and handle it.
    return error;
  }, [supabase]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName?: string,
  ): Promise<AuthError | null> => {
    if (!supabase) {
      return { name: 'AuthError', message: 'Supabase is not configured.' } as AuthError;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName ?? '' } },
    });

    // Best-effort profile INSERT (not upsert) only when the DB trigger may have
    // missed and we have an immediate session. Never overwrites existing rows.
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
        /* Profile already exists from trigger — ignore conflict */
      }
    }

    return error;
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await forceLocalSignOut(supabase);
    // Clear state immediately. onAuthStateChange will also fire SIGNED_OUT.
    setUser(null);
    setSession(null);
    setApproved(false);
  }, [supabase]);

  // ── Context value (memoized to prevent unnecessary re-renders) ──────────────

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
