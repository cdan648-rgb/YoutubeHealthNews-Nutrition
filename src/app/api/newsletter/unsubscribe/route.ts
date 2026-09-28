import { NextResponse } from 'next/server';
import { unsubscribe } from '@/lib/newsletter/lifecycle';
import { routes } from '@/lib/site';

/**
 * Unsubscribe — POST only.
 *
 * There is deliberately no GET handler. An email client that prefetches links would silently
 * unsubscribe real readers if a GET did the work, so the human path is a confirmation page
 * (`/huy-dang-ky`) whose button POSTs here, and the machine path is the RFC 8058 one-click
 * header, which is a POST by definition. Both carry the subscriber id and a signed token; the
 * id alone is useless without the token.
 *
 * Accepts a form post (the confirmation page) or the one-click body, and answers in kind.
 * Any unexpected failure returns a controlled response so a one-click header sees a proper
 * status rather than an HTML 500 page.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  // The one-click header carries the parameters in the query string.
  let subscriberId = url.searchParams.get('u') ?? '';
  let token = url.searchParams.get('t') ?? '';

  const contentType = request.headers.get('content-type') ?? '';
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');

  try {
    if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      const form = await request.formData().catch(() => null);
      if (form !== null) {
        const u = form.get('u');
        const t = form.get('t');
        if (typeof u === 'string') subscriberId = u;
        if (typeof t === 'string') token = t;
      }
    }

    const outcome = await unsubscribe(subscriberId, token);

    if (wantsJson || !contentType.includes('form')) {
      // One-click clients want a 200 with no redirect; a bad token is a 400.
      return NextResponse.json({ outcome }, { status: outcome === 'invalid' ? 400 : 200 });
    }

    return NextResponse.redirect(new URL(`${routes.unsubscribe()}?state=${outcome}`, request.url), {
      status: 303,
    });
  } catch (cause) {
    console.error(
      'newsletter unsubscribe: unexpected failure',
      cause instanceof Error ? cause.message : String(cause),
    );
    if (wantsJson || !contentType.includes('form')) {
      return NextResponse.json({ outcome: 'error', reason: 'server_error' }, { status: 503 });
    }
    return NextResponse.redirect(
      new URL(`${routes.unsubscribe()}?state=error&reason=server_error`, request.url),
      { status: 303 },
    );
  }
}
