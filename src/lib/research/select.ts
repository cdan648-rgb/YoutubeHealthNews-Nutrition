/**
 * Research-source selection.
 *
 * SEAM ONLY at this stage. The scheduler needs to be able to ask for a paper so the
 * no-source path is complete and testable; the selection algorithm itself — candidate
 * retrieval, scoring, the four dedup keys — is the research-fallback phase.
 *
 * Returning null is the correct conservative behaviour until then: a dry spell records
 * `no_source`, the streak keeps climbing, and nothing unvetted publishes.
 */
import 'server-only';

import type { InternalClient } from '@/lib/supabase/service';

export type ClaimedPaper = { readonly id: string; readonly title: string };

export async function claimResearchSource(_client?: InternalClient): Promise<ClaimedPaper | null> {
  // Deliberately not implemented yet. See the research-fallback phase.
  return Promise.resolve(null);
}
