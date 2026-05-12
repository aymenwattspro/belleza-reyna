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
  const { user, loading, approved, signOut } = useAuth();

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

  // Show spinner while Supabase resolves auth + profile
  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Authenticated but not yet approved by admin
  if (!approved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50 px-4">
        <div className="w-full max-w-sm text-center bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-pink-200/40 border border-pink-100/50 p-10 space-y-5">
          {/* Hourglass icon */}
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-100 to-fuchsia-100 flex items-center justify-center text-3xl shadow-inner">
              ⏳
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold text-gray-800">Access Pending Approval</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              Your account has been created successfully.<br />
              An admin must approve your access before you can use the app.
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 font-medium text-left space-y-1">
            <p className="font-semibold">Signed in as:</p>
            <p className="font-mono break-all text-amber-800">{user.email}</p>
          </div>

          <button
            onClick={() => signOut()}
            className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all"
          >
            Sign out
          </button>
        </div>
        <Toaster position="top-right" richColors expand closeButton />
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
