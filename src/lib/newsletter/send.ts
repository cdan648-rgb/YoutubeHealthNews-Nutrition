/**
 * Newsletter delivery.
 *
 * SEAM ONLY at this stage. The scheduler calls this after a successful publication so the
 * notify step exists in the state machine and is exercised by the concurrency tests; the
 * campaign, per-recipient sends and provider integration are the newsletter phase.
 *
 * A no-op here is safe: the article is already published, and a missing announcement is not
 * a reason to roll that back.
 */
import 'server-only';

import type { InternalClient } from '@/lib/supabase/service';

export async function queueCampaign(_articleId: string, _client?: InternalClient): Promise<void> {
  // Deliberately not implemented yet. See the newsletter phase.
  return Promise.resolve();
}
