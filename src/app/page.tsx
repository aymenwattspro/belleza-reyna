'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// Root page — smart redirect:
// • Authenticated  → /inventory-hub
// • Not auth'd     → /login
export default function RootPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return; // wait for Supabase to resolve session

    if (user) {
      router.replace('/inventory-hub');
    } else {
      router.replace('/login');
    }
  }, [loading, user, router]);

  // Blank while redirecting — no flash of content
  return null;
}
