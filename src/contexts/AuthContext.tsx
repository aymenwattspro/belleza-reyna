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

/** Single profile fetch — by user.id only, never by email. Never throws. */
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
  } catch (e) {
    console.error('[AuthContext] fetchIsApproved failed:', e);
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

  // Stable Supabase client — never re-created across renders
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (configured && !supabaseRef.current) {
    supabaseRef.current = getSupabaseClient();
  }
  const supabase = supabaseRef.current;

  // ── Bootstrap effect ─────────────────────────────────────────────────────────
  // Runs ONCE on mount. Sets up exactly one auth listener.
  // EVERY code path is wrapped in try/finally so setLoading(false) ALWAYS fires.
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    // ── 1) Initial check ──────────────────────────────────────────────────────
    const runInitialCheck = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();

        if (!isMounted) return;

        if (!authUser) {
          setUser(null);
          setSession(null);
          setApproved(false);
          return; // finally still runs → loading=false
        }

        const { data: { session: authSession } } = await supabase.auth.getSession();
        const isApproved = await fetchIsApproved(supabase, authUser.id);

        if (!isMounted) return;

        setSession(authSession);
        setUser(authUser);
        setApproved(isApproved);
      } catch (e) {
        console.error('[AuthContext] initial check error:', e);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    runInitialCheck();

    // ── 2) Single auth listener — only reacts to SIGNED_IN / SIGNED_OUT ──────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, nextSession) => {
        if (!isMounted) return;

        // Ignore everything except SIGNED_IN and SIGNED_OUT to avoid redundant
        // DB queries on TOKEN_REFRESHED, INITIAL_SESSION, USER_UPDATED, etc.
        if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;

        try {
          if (event === 'SIGNED_OUT') {
            setUser(null);
            setSession(null);
            setApproved(false);
            return; // finally still runs → loading=false
          }

          // SIGNED_IN
          if (!nextSession?.user) return;

          setLoading(true);
          const isApproved = await fetchIsApproved(supabase, nextSession.user.id);

          if (!isMounted) return;

          setSession(nextSession);
          setUser(nextSession.user);
          setApproved(isApproved);
        } catch (e) {
          console.error('[AuthContext] auth state change error:', e);
        } finally {
          if (isMounted) setLoading(false);
        }
      },
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
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
    // No manual state mutation — onAuthStateChange will fire SIGNED_IN.
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

    // Best-effort INSERT (not upsert) for the case where the DB trigger may
    // have failed and an immediate session was returned. Never overwrites.
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
        /* Profile likely already exists from trigger — ignore conflict */
      }
    }

    return error;
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await forceLocalSignOut(supabase);
    } finally {
      setUser(null);
      setSession(null);
      setApproved(false);
      setLoading(false);
    }
  }, [supabase]);

  // ── Context value (memoized to avoid downstream re-renders) ────────────────

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
