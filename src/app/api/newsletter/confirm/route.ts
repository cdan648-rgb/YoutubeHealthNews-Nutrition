import { NextResponse } from 'next/server';
import { confirmSubscription } from '@/lib/newsletter/lifecycle';
import { routes } from '@/lib/site';

/**
 * Double-opt-in confirmation.
 *
 * A GET, because the person clicked a link in their own email — confirming is idempotent and
 * the token is a single-use secret, so the prefetch hazard that makes GET-unsubscribe unsafe
 * does not apply here (the worst a scanner can do is confirm an address its owner already
 * asked to subscribe). The result is shown by redirecting to the confirmation page with a
 * state, so there is one place that renders subscription outcomes.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const outcome = await confirmSubscription(token);
  return NextResponse.redirect(
    new URL(`${routes.newsletterConfirmed()}?state=${outcome}`, request.url),
    { status: 303 },
  );
}
