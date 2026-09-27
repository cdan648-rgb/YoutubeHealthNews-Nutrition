/**
 * Service-role Supabase clients. SERVER ONLY.
 *
 * This key bypasses RLS and can reach the `internal` schema, so it must never enter
 * a browser bundle. Three things keep that true:
 *
 *   1. `import 'server-only'` — importing this from a client component is a BUILD
 *      error, not a runtime surprise;
 *   2. the key is read from a non-`NEXT_PUBLIC_` variable, so Next.js will not
 *      inline it;
 *   3. `scripts/check-no-secrets.mjs` greps the built client bundle for both the
 *      key's shape and its variable name, and fails the build on a hit.
 *
 * Use these only in route handlers, server actions, Edge Functions and scripts.
 * Public pages read through `@/lib/supabase/server`, which uses the anon key so RLS
 * applies to the site itself.
 *
 * Two clients rather than one, because they target different schemas:
 *   `serviceClient()`  — `public` tables with RLS bypassed (writing articles).
 *   `internalClient()` — the non-exposed `internal` schema, fully typed by
 *                        `InternalDatabase`. Typing it properly rather than casting
 *                        to `any` matters: these are the queries that enforce the
 *                        one-article-per-Hanoi-day guarantee.
 */
import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { InternalDatabase } from '@/lib/supabase/internal.types';

export type ServiceClient = SupabaseClient<Database, 'public'>;
export type InternalClient = SupabaseClient<InternalDatabase, 'internal'>;

let cachedService: ServiceClient | null = null;
let cachedInternal: InternalClient | null = null;

function credentials(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url === undefined || url === '') {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set.');
  }
  if (key === undefined || key === '') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is server-only: never add a NEXT_PUBLIC_ prefix to it.',
    );
  }
  return { url, key };
}

const OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

/** RLS-bypassing client for the `public` schema. */
export function serviceClient(): ServiceClient {
  if (cachedService === null) {
    const { url, key } = credentials();
    cachedService = createClient<Database, 'public'>(url, key, {
      ...OPTIONS,
      global: { headers: { 'x-application-name': 'suc-khoe-giai-ma/service' } },
    });
  }
  return cachedService;
}

/** Typed client for the non-exposed `internal` schema. */
export function internalClient(): InternalClient {
  if (cachedInternal === null) {
    const { url, key } = credentials();
    cachedInternal = createClient<InternalDatabase, 'internal'>(url, key, {
      ...OPTIONS,
      db: { schema: 'internal' },
      global: { headers: { 'x-application-name': 'suc-khoe-giai-ma/internal' } },
    });
  }
  return cachedInternal;
}

/** Test seam: drops the memoised clients so env changes take effect. */
export function resetServiceClients(): void {
  cachedService = null;
  cachedInternal = null;
}
