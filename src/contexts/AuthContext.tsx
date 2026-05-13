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
import { useRouter } from 'next/navigation';
import type { User, Session, AuthError, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  email: string | null;
  is_approved: boolean;
  role: string;
  created_at: string;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  /** True while the initial auth + profile check is in progress. */
  loading: boolean;
  /** True when NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are not set / invalid. */
  notConfigured: boolean;
  /** Derived from profile.is_approved. Convenience for callers. */
  approved: boolean;
  signIn:  (email: string, password: string) => Promise<AuthError | null>;
  signUp:  (email: string, password: string, fullName?: string) => Promise<AuthError | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const configured = isSupabaseConfigured();

  // Stable Supabase client — never re-created across renders
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (configured && !supabaseRef.current) {
    supabaseRef.current = getSupabaseClient();
  }
  const supabase = supabaseRef.current;

  // isMountedRef guards every async state write
  const isMountedRef = useRef(true);

  // ── Single source of truth: initAuth ─────────────────────────────────────────
  // Always wrapped in try / catch / finally. setLoading(false) is GUARANTEED.
  const initAuth = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // 1) Get user (validates session against the auth server — never stale)
      const { data: { user: authUser } } = await supabase.auth.getUser();

      if (!isMountedRef.current) return;

      // 2) No user → clear all state and stop
      if (!authUser) {
        setUser(null);
        setProfile(null);
        setSession(null);
        return; // finally still runs → loading = false
      }

      // 3) Fetch session + profile ONCE
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (!isMountedRef.current) return;

      setUser(authUser);
      setSession(authSession);
      setProfile(profileError ? null : (profileData as Profile | null));
    } catch (e) {
      console.error('[AuthContext] initAuth error:', e);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [supabase]);

  // ── Bootstrap effect ─────────────────────────────────────────────────────────
  // Runs ONCE on mount. Sets up exactly one auth listener and cleans up on unmount.
  useEffect(() => {
    isMountedRef.current = true;

    if (!supabase) {
      setLoading(false);
      return;
    }

    // Initial auth check
    initAuth();

    // React ONLY to SIGNED_IN and SIGNED_OUT — call initAuth() each time.
    // Ignores TOKEN_REFRESHED, INITIAL_SESSION, USER_UPDATED, PASSWORD_RECOVERY
    // to avoid redundant DB queries.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!isMountedRef.current) return;
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        initAuth();
      }
    });

    return () => {
      isMountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [supabase, initAuth]);

  // ── Auth actions ─────────────────────────────────────────────────────────────

  const signIn = useCallback(async (
    email: string,
    password: string,
  ): Promise<AuthError | null> => {
    if (!supabase) {
      return { name: 'AuthError', message: 'Supabase is not configured.' } as AuthError;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // onAuthStateChange will fire SIGNED_IN → initAuth() runs → state updates.
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

    // Best-effort INSERT (not upsert) — only when an immediate session is
    // returned (email confirmation disabled). Never overwrites existing rows.
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
        /* Profile likely already exists from DB trigger — ignore conflict */
      }
    }

    return error;
  }, [supabase]);

  const signOut = useCallback(async () => {
    // Always end up on /login regardless of whether Supabase reachable.
    try {
      if (supabase) await supabase.auth.signOut();
    } catch (e) {
      console.error('[AuthContext] signOut error:', e);
    } finally {
      // Clear all auth state synchronously so no component sees stale auth.
      if (isMountedRef.current) {
        setUser(null);
        setProfile(null);
        setSession(null);
        setLoading(false);
      }
      // Single immediate redirect — replace() prevents back-navigation
      // to authenticated pages.
      router.replace('/login');
    }
  }, [supabase, router]);

  // ── Context value (memoized to avoid downstream re-renders) ────────────────

  const approved = profile?.is_approved === true;

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    session,
    loading,
    notConfigured: !configured,
    approved,
    signIn,
    signUp,
    signOut,
  }), [user, profile, session, loading, configured, approved, signIn, signUp, signOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
