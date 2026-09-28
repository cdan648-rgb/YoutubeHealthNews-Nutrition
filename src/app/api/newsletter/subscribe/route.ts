import { NextResponse } from 'next/server';
import { subscribe, type SubscribeOutcome } from '@/lib/newsletter/subscribe';
import { routes } from '@/lib/site';

/**
 * Newsletter signup.
 *
 * Accepts both a plain HTML form post (the no-JS inline form degrades to a redirect) and a
 * JSON body (the modal's fetch). The response is deliberately uniform for every address —
 * new, pending or active all return the same "check your email" — so the endpoint cannot be
 * used to discover who is on the list.
 *
 * Two failure principles that live at THIS layer:
 *
 *   1. an unexpected server error MUST NOT bubble to Next.js's generic HTML 500 page. That
 *      page is unstyled, is served with content-type text/html to a JSON fetch (which the
 *      modal can only report as "invalid or unverifiable"), and leaks a stack trace. The
 *      route wraps `subscribe()` in try/catch and returns a controlled JSON/redirect answer
 *      instead — the person sees "please try again" and we get the real error in the logs.
 *
 *   2. optional providers (Turnstile secret, Resend key) that are not configured must not
 *      break signup. `subscribe.ts` treats them as absent when their env vars are missing
 *      (Turnstile verification is skipped, email delivery is `not_configured` and logged);
 *      this route does not add any new configuration requirements.
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

/**
 * Render a subscribe outcome onto the response.
 *
 * The redirect path preserves the same information the JSON path returns: a `state` of
 * check-email/rate-limited/error, plus the reason for the last two so the confirmation page
 * can explain what happened.
 */
function respond(outcome: SubscribeOutcome, wantsJson: boolean, requestUrl: string): NextResponse {
  if (wantsJson) {
    const status = outcome.status === 'rate_limited' ? 429 : outcome.status === 'ok' ? 200 : 400;
    return NextResponse.json(outcome, { status });
  }

  const base = routes.newsletterConfirmed();
  const query =
    outcome.status === 'ok'
      ? 'state=check-email'
      : outcome.status === 'rate_limited'
        ? 'state=rate-limited'
        : `state=error&reason=${encodeURIComponent(
            outcome.status === 'invalid' ? outcome.reason : outcome.reason,
          )}`;
  return NextResponse.redirect(new URL(`${base}?${query}`, requestUrl), { status: 303 });
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

  try {
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
  } catch (cause) {
    // A malformed body should not 500 — treat as a bad request.
    console.error('newsletter subscribe: could not parse request body', cause);
    return respond({ status: 'invalid', reason: 'bad_request' }, wantsJson, request.url);
  }

  try {
    const outcome = await subscribe({
      email,
      honeypot,
      turnstileToken,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      source,
    });
    return respond(outcome, wantsJson, request.url);
  } catch (cause) {
    // A DB/provider/whatever failure must not surface as Next.js's raw 500 page: the modal
    // would render it as the generic "invalid or unverifiable" message and the no-JS form
    // would land the person on an unstyled error screen. Return a stable, styled response
    // and log the real cause to the server so we can debug from Vercel's logs.
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error('newsletter subscribe: unexpected failure', message);
    if (wantsJson) {
      return NextResponse.json(
        { status: 'error', reason: 'server_error' },
        // 503 rather than 500: this is a transient upstream problem from the caller's point
        // of view, and it says "try again later" to well-behaved clients.
        { status: 503 },
      );
    }
    const url = new URL(
      `${routes.newsletterConfirmed()}?state=error&reason=server_error`,
      request.url,
    );
    return NextResponse.redirect(url, { status: 303 });
  }
}
