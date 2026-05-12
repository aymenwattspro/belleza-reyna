'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { User, Session, AuthError } from '@supabase/supabase-js';
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

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [approved, setApproved] = useState(false);

  const configured = isSupabaseConfigured();
  const supabase = configured ? getSupabaseClient() : null;

  // ── Poll approval status while user is pending (every 8 seconds) ─────────────
  useEffect(() => {
    if (!user || approved) return; // Only poll when user exists but is NOT approved
    const interval = setInterval(() => {
      fetchApproval(user.id);
    }, 8000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, approved]);

  // ── Fetch approval status from profiles table ────────────────────────────────
  const fetchApproval = useCallback(async (userId: string | null) => {
    if (!supabase || !userId) {
      setApproved(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('approved')
        .eq('id', userId)
        .single();
      // Any error (table not found, network, RLS) → default to NOT approved
      if (error || !data) {
        console.log('Approval check error:', error?.message || 'No data found');
        setApproved(false);
        return;
      }
      setApproved((data as { approved?: boolean })?.approved === true);
    } catch (err) {
      // Network failure or any unexpected error → default to NOT approved
      console.log('Approval check failed:', err);
      setApproved(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      // Supabase not configured — skip auth resolution, mark as done
      setLoading(false);
      return;
    }

    // Add timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      if (loading) {
        console.log('Auth initialization timeout - forcing completion');
        setLoading(false);
      }
    }, 5000); // 5 second timeout

    // Get the current session on mount, then fetch approval
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      await fetchApproval(session?.user?.id ?? null);
      clearTimeout(timeout);
      setLoading(false);
    }).catch((err) => {
      console.log('Session fetch failed:', err);
      clearTimeout(timeout);
      setLoading(false);
    });

    // Listen for auth state changes (login / logout / token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        // Only re-enter loading when a real user session is present —
        // avoids blocking the login page on initial load (no-session) or logout.
        if (session?.user) setLoading(true);
        setSession(session);
        setUser(session?.user ?? null);
        await fetchApproval(session?.user?.id ?? null);
        setLoading(false);
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run only once

  // ── Sign In ─────────────────────────────────────────────────────────────────
  const signIn = useCallback(async (email: string, password: string): Promise<AuthError | null> => {
    if (!supabase) return { name: 'AuthError', message: 'Supabase is not configured. Follow SUPABASE_SETUP.md.' } as AuthError;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  }, [supabase]);

  // ── Sign Up ─────────────────────────────────────────────────────────────────
  const signUp = useCallback(async (email: string, password: string, fullName?: string): Promise<AuthError | null> => {
    if (!supabase) return { name: 'AuthError', message: 'Supabase is not configured. Follow SUPABASE_SETUP.md.' } as AuthError;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName ?? '' } },
    });
    return error;
  }, [supabase]);

  // ── Sign Out ────────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setApproved(false);
  }, [supabase]);

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
