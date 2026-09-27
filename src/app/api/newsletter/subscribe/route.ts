import { NextResponse } from 'next/server';
import { subscribe } from '@/lib/newsletter/subscribe';
import { routes } from '@/lib/site';

/**
 * Newsletter signup.
 *
 * Accepts both a plain HTML form post (the no-JS inline form degrades to a redirect) and a
 * JSON body (the modal's fetch). The response is deliberately uniform for every address —
 * new, pending or active all return the same "check your email" — so the endpoint cannot be
 * used to discover who is on the list.
 *
 * Runs on Node because the subscribe path uses the service-role client and Node crypto.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A form field as a string, or null. FormData.get can return a File; those are ignored. */
function field(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === 'string' ? value : null;
}

/** First hop in X-Forwarded-For is the client; the rest are proxies we control. */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded !== '') return forwarded.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip');
}

export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get('content-type') ?? '';
  const wantsJson =
    contentType.includes('application/json') ||
    (request.headers.get('accept') ?? '').includes('application/json');

  let email = '';
  let honeypot: string | null = null;
  let turnstileToken: string | null = null;
  let source: string | null = null;

  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    email = typeof body.email === 'string' ? body.email : '';
    honeypot = typeof body.company === 'string' ? body.company : null;
    turnstileToken =
      typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : null;
    source = typeof body.source === 'string' ? body.source : null;
  } else {
    const form = await request.formData();
    email = field(form, 'email') ?? '';
    honeypot = field(form, 'company');
    turnstileToken = field(form, 'cf-turnstile-response');
    source = field(form, 'source');
  }

  const outcome = await subscribe({
    email,
    honeypot,
    turnstileToken,
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    source,
  });

  if (wantsJson) {
    const status = outcome.status === 'rate_limited' ? 429 : outcome.status === 'ok' ? 200 : 400;
    return NextResponse.json(outcome, { status });
  }

  // No-JS form: redirect to a page that states what happens next. The neutral "check your
  // email" is shown for ok; other states carry a reason the page can explain.
  const base = routes.newsletterConfirmed();
  const query =
    outcome.status === 'ok'
      ? 'state=check-email'
      : outcome.status === 'rate_limited'
        ? 'state=rate-limited'
        : `state=error&reason=${encodeURIComponent(outcome.status === 'invalid' ? outcome.reason : outcome.reason)}`;
  return NextResponse.redirect(new URL(`${base}?${query}`, request.url), { status: 303 });
}
