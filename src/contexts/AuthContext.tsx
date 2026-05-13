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
   * Updated on auth events and immediately after sign-in / sign-up.
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

  // ── Centralized hydration ────────────────────────────────────────────────────
  // The single source of truth for hydrating auth state.
  // Always wrapped in try/finally → setLoading(false) is guaranteed.
  // Called by: bootstrap, onAuthStateChange, signIn, signUp.
  const isMountedRef = useRef(true);
  // Suppresses the duplicate profile fetch from onAuthStateChange when signIn
  // or signUp has just hydrated manually (avoids 2 profile calls per login).
  const skipNextEventRef = useRef(false);

  const hydrate = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data: { user: authUser } } = await supabase.auth.getUser();

      if (!isMountedRef.current) return;

      if (!authUser) {
        setUser(null);
        setSession(null);
        setApproved(false);
        return;
      }

      const { data: { session: authSession } } = await supabase.auth.getSession();
      const isApproved = await fetchIsApproved(supabase, authUser.id);

      if (!isMountedRef.current) return;

      setSession(authSession);
      setUser(authUser);
      setApproved(isApproved);
    } catch (e) {
      console.error('[AuthContext] hydrate failed:', e);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [supabase]);

  // ── Bootstrap effect ─────────────────────────────────────────────────────────
  // Runs ONCE on mount. Sets up exactly one auth listener.
  useEffect(() => {
    isMountedRef.current = true;

    if (!supabase) {
      setLoading(false);
      return;
    }

    // Initial hydration
    hydrate();

    // Single auth listener — only acts on SIGNED_IN / SIGNED_OUT
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, nextSession) => {
        if (!isMountedRef.current) return;
        if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;

        // Deduplicate: if signIn/signUp already hydrated, skip this fetch
        if (event === 'SIGNED_IN' && skipNextEventRef.current) {
          skipNextEventRef.current = false;
          return;
        }

        try {
          if (event === 'SIGNED_OUT') {
            setUser(null);
            setSession(null);
            setApproved(false);
            return;
          }

          // SIGNED_IN
          if (!nextSession?.user) return;
          setLoading(true);
          const isApproved = await fetchIsApproved(supabase, nextSession.user.id);
          if (!isMountedRef.current) return;
          setSession(nextSession);
          setUser(nextSession.user);
          setApproved(isApproved);
        } catch (e) {
          console.error('[AuthContext] auth state change error:', e);
        } finally {
          if (isMountedRef.current) setLoading(false);
        }
      },
    );

    return () => {
      isMountedRef.current = false;
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

    try {
      setLoading(true);
      // Tell the listener to skip the duplicate fetch — we'll hydrate here.
      skipNextEventRef.current = true;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        skipNextEventRef.current = false; // Reset on failure (no SIGNED_IN fires)
        return error;
      }

      // Direct hydration — don't rely solely on onAuthStateChange.
      // hydrate() always validates via getUser() and fetches the profile.
      await hydrate();
      return null;
    } catch (e) {
      skipNextEventRef.current = false;
      console.error('[AuthContext] signIn error:', e);
      return { name: 'AuthError', message: 'Sign-in failed.' } as AuthError;
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [supabase, hydrate]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName?: string,
  ): Promise<AuthError | null> => {
    if (!supabase) {
      return { name: 'AuthError', message: 'Supabase is not configured.' } as AuthError;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName ?? '' } },
      });

      if (error) return error;

      // Best-effort INSERT (not upsert) — never overwrites existing rows.
      // Only when an immediate session is returned (email confirmation off).
      if (data.user && data.session) {
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

        // Tell the listener to skip its duplicate fetch — we hydrate here.
        skipNextEventRef.current = true;
        // Hydrate immediately so the UI can redirect without waiting on the
        // onAuthStateChange listener.
        await hydrate();
      }

      return null;
    } catch (e) {
      console.error('[AuthContext] signUp error:', e);
      return { name: 'AuthError', message: 'Sign-up failed.' } as AuthError;
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [supabase, hydrate]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await forceLocalSignOut(supabase);
    } finally {
      if (isMountedRef.current) {
        setUser(null);
        setSession(null);
        setApproved(false);
        setLoading(false);
      }
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
