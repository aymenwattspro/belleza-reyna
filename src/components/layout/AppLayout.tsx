'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Toaster } from 'sonner';
import { Sidebar } from './Sidebar';
import { ChatWidget } from '@/components/chatbot/ChatWidget';
import { useAuth } from '@/contexts/AuthContext';

const PUBLIC_PATHS = ['/login'];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();

  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (!loading && !user && !isPublic) {
      router.replace('/login');
    }
  }, [loading, user, isPublic, router]);

  // Always render public paths immediately (login page)
  if (isPublic) {
    return (
      <>
        {children}
        <Toaster position="top-right" richColors expand closeButton />
      </>
    );
  }

  // Show spinner while Supabase resolves auth
  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 ml-64 min-h-screen">
        <main className="min-h-screen">{children}</main>
      </div>
      <ChatWidget />
      <Toaster position="top-right" richColors expand closeButton />
    </div>
  );
}
