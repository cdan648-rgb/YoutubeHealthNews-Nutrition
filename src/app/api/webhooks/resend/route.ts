import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { internalClient } from '@/lib/supabase/service';
import { normalizeEmailAddress } from '@/lib/newsletter/normalize';

/**
 * Resend delivery webhook.
 *
 * A bounce or a complaint must remove the address from future fan-outs — continuing to mail a
 * bounced address wrecks sender reputation, and mailing someone who marked us as spam is both
 * rude and harmful. So this flips the subscriber to `bounced` or `complained`, which the
 * fan-out query (`status = 'active'`) then excludes automatically.
 *
 * Signature verification is the Svix scheme Resend uses, done in constant time. If the
 * webhook secret is not configured the endpoint fails closed with 503 rather than trusting an
 * unverified payload — an unauthenticated webhook that can change subscriber state is worse
 * than one that is temporarily unavailable.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifySignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
  header: string,
): boolean {
  // Resend/Svix secrets are "whsec_<base64>"; the bytes after the prefix are the HMAC key.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');

  // The header is a space-separated list of "v1,<signature>" pairs; any match passes.
  for (const part of header.split(' ')) {
    const signature = part.includes(',') ? (part.split(',')[1] ?? '') : part;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

function recipientEmail(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null;
  const record = data as { to?: unknown; email?: unknown };
  if (typeof record.email === 'string') return record.email;
  if (Array.isArray(record.to) && typeof record.to[0] === 'string') return record.to[0];
  if (typeof record.to === 'string') return record.to;
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret === undefined || secret === '') {
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 503 });
  }

  const body = await request.text();
  const id = request.headers.get('svix-id') ?? '';
  const timestamp = request.headers.get('svix-timestamp') ?? '';
  const signature = request.headers.get('svix-signature') ?? '';

  if (
    id === '' ||
    timestamp === '' ||
    signature === '' ||
    !verifySignature(secret, id, timestamp, body, signature)
  ) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(body) as { type?: string; data?: unknown };
  const type = event.type ?? '';

  const status =
    type === 'email.bounced' ? 'bounced' : type === 'email.complained' ? 'complained' : null;
  if (status === null) {
    // Delivered/opened/clicked and the like: acknowledged, nothing to change.
    return NextResponse.json({ ok: true, ignored: type }, { status: 200 });
  }

  const email = recipientEmail(event.data);
  if (email === null) return NextResponse.json({ ok: true, note: 'no recipient' }, { status: 200 });

  const client = internalClient();
  const normalized = normalizeEmailAddress(email);
  await client
    .from('subscribers')
    .update({ status })
    .eq('email_normalized', normalized)
    // Do not resurrect an unsubscribed row into a bounced one; only touch mailable states.
    .in('status', ['active', 'pending']);

  await client.from('job_logs').insert({
    level: 'warn',
    code: status === 'bounced' ? 'email_bounced' : 'email_complained',
    stage: 'webhook',
    message: `subscriber marked ${status}`,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
