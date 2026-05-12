import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Returns true only when the Supabase keys look like a valid project URL + key.
 *
 * Common mistakes caught here:
 *  - Using the Supabase *dashboard* URL   (https://supabase.com/dashboard/project/…)
 *    instead of the *project API* URL     (https://<id>.supabase.co)
 *  - Empty / undefined env vars
 */
export const isSupabaseConfigured = (): boolean => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;

  // Detect the most common mistake: pasting the dashboard URL
  if (SUPABASE_URL.includes('supabase.com/dashboard')) {
    console.error(
      '[Supabase config error] NEXT_PUBLIC_SUPABASE_URL is set to the dashboard URL.\n' +
      `  Current value : ${SUPABASE_URL}\n` +
      '  Expected value: https://<your-project-id>.supabase.co\n' +
      '  Fix → Vercel dashboard → Settings → Environment Variables → update NEXT_PUBLIC_SUPABASE_URL'
    );
    return false;
  }

  return true;
};

// ── Browser-side Supabase client ──────────────────────────────────────────────
// Use this in all 'use client' components.
// Returns null if env variables are not yet configured.
export function createClient() {
  if (!isSupabaseConfigured()) return null;
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Singleton for convenience in client components
let client: ReturnType<typeof createBrowserClient<Database>> | null = null;
export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}
