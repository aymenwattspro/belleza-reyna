'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// Root page — smart redirect:
// • Authenticated  → /inventory-hub
// • Not auth'd     → /login
// • Not configured → /inventory-hub (dev mode without Supabase keys)
export default function RootPage() {
  const router = useRouter();
  const { user, loading, notConfigured } = useAuth();

  useEffect(() => {
    if (loading) return; // wait for Supabase to resolve session

    if (notConfigured || user) {
      router.replace('/inventory-hub');
    } else {
      router.replace('/login');
    }
  }, [loading, user, notConfigured, router]);

  // Blank while redirecting — no flash of content
  return null;
}
