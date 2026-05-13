'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { User, Session, AuthError, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  /** True while Supabase is resolving the initial session AND profile. */
  loading: boolean;
  /** True when NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are not set / invalid. */
  notConfigured: boolean;
  /**
   * True once an admin has set approved = true in the profiles table.
   * Authenticated users with approved = false see the "pending approval" screen.
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

/** Force-clear the local Supabase session without contacting the server. */
async function forceLocalSignOut(supabase: SupabaseClient) {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Ignore - local clear always works even if the network request fails
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [approved, setApproved] = useState(false);

  const configured = isSupabaseConfigured();
  const supabase = configured ? getSupabaseClient() : null;

  // ── Fetch approval status ────────────────────────────────────────────────────
  // Returns false by default on any error (fail-safe / deny by default).
  // If the profile row doesn't exist (PGRST116 = no rows) for an authenticated
  // user, we force a local sign-out — this clears stale sessions for deleted users.
  const fetchApproval = useCallback(async (userId: string | null): Promise<boolean> => {
    if (!supabase || !userId) return false;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_approved')
        .eq('id', userId)
        .single();

      if (error) {
        // PGRST116 = no rows returned — user profile was deleted (or never created)
        // Force a local sign-out so the stale browser session is cleared immediately
        if (error.code === 'PGRST116') {
          await forceLocalSignOut(supabase);
          setUser(null);
          setSession(null);
        }
        return false;
      }

      return (data as { is_approved?: boolean })?.is_approved === true;
    } catch {
      return false;
    }
  }, [supabase]);

  // ── Poll approval every 8s while user is present but NOT yet approved ────────
  useEffect(() => {
    if (!user || approved) return;
    const interval = setInterval(async () => {
      const result = await fetchApproval(user.id);
      setApproved(result);
    }, 8000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, approved]);

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Initial session check
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      const ok = await fetchApproval(session?.user?.id ?? null);
      setApproved(ok);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    // Live auth state changes (sign-in, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        // Only block on loading while we check approval for a real session
        if (session?.user) setLoading(true);
        setSession(session);
        setUser(session?.user ?? null);
        const ok = await fetchApproval(session?.user?.id ?? null);
        setApproved(ok);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auth actions ─────────────────────────────────────────────────────────────

  const signIn = useCallback(async (email: string, password: string): Promise<AuthError | null> => {
    if (!supabase) return { name: 'AuthError', message: 'Supabase is not configured.' } as AuthError;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  }, [supabase]);

  const signUp = useCallback(async (email: string, password: string, fullName?: string): Promise<AuthError | null> => {
    if (!supabase) return { name: 'AuthError', message: 'Supabase is not configured.' } as AuthError;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName ?? '' } },
    });
    return error;
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    // Use local scope — always clears the browser session even if the server
    // rejects the request (e.g. user was deleted from Supabase auth.users).
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
