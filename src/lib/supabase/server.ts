/**
 * Read-only Supabase client for server components.
 *
 * Deliberately uses the ANON key, not the service role. Every public page reads
 * through this, so RLS applies to the site itself: if a policy is wrong, the bug
 * surfaces as a missing article rather than as a leak of drafts. The browser never
 * talks to Supabase at all, so RLS is defence in depth rather than the only line.
 *
 * There is no cookie/session handling here because the site has no reader accounts.
 * That keeps every page cacheable and avoids pulling `next/headers` into routes that
 * would then be forced dynamic.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export type PublicClient = SupabaseClient<Database, 'public'>;

let cached: PublicClient | null = null;

function requireEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill in the Supabase project values.`,
    );
  }
  return value;
}

/**
 * The shared public client.
 *
 * Cached per process: it holds no per-request state, so building a new one for each
 * render would only add allocation. `persistSession` is off because there is no
 * session to persist on a server.
 */
export function publicClient(): PublicClient {
  cached ??= createClient<Database, 'public'>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'suc-khoe-giai-ma/web' } },
    },
  );
  return cached;
}

/** Test seam: drops the memoised client so env changes take effect. */
export function resetPublicClient(): void {
  cached = null;
}
