/**
 * The signup use case. SERVER ONLY.
 *
 * The browser never touches `internal.subscribers` — this runs behind a route handler with
 * the service-role key so five protections are enforced in one place that a client insert
 * could not: honeypot, Turnstile, IP rate limit, address normalisation and consent capture.
 *
 * The most important property is that the response is IDENTICAL whether the address is new,
 * already pending or already active. A different answer for a known address turns the
 * endpoint into an email-enumeration oracle, so "we sent a confirmation" is always the reply,
 * and only a genuinely new or unconfirmed address actually gets an email. This also makes
 * the endpoint safe to expose without leaking who is on the list.
 *
 * Every database call goes through `NewsletterGateway` (public.newsletter_* RPCs), not the
 * private `internal` schema directly, because that schema is not exposed to the Data API.
 */
import 'server-only';

import type { NewsletterGateway } from '@/lib/automation/internal-gateway';
import { liveNewsletterGateway } from '@/lib/automation/internal-gateway';
import type { EmailProvider } from './provider';
import { createEmailProvider } from './provider';
import { confirmEmail } from './templates';
import {
  CONSENT_TEXT_VERSION,
  generateToken,
  hashIp,
  hashToken,
  unsubscribeTokenHash,
} from './tokens';
import { verifyTurnstile } from './turnstile';
import { normalizeEmailAddress } from './normalize';
import { absoluteUrl, routes } from '@/lib/site';

/** Signups allowed per IP per window. Generous for a household, tight against a flood. */
export const RATE_LIMIT = { max: 5, windowSeconds: 60 } as const;

/** How long a confirmation link is valid. Long enough for an email to be read later that day. */
const CONFIRM_TTL_HOURS = 48;

export type SubscribeInput = {
  readonly email: string;
  readonly honeypot: string | null;
  readonly turnstileToken: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly source: string | null;
};

export type SubscribeOutcome =
  | { readonly status: 'ok' }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'rate_limited' }
  | { readonly status: 'blocked'; readonly reason: string };

export type SubscribeDeps = {
  readonly gateway?: NewsletterGateway;
  readonly provider?: EmailProvider;
  readonly fetchImpl?: typeof fetch;
  /** Injected in tests so no verification-service call is made. */
  readonly verify?: typeof verifyTurnstile;
  readonly now?: () => Date;
};

export async function subscribe(
  input: SubscribeInput,
  deps: SubscribeDeps = {},
): Promise<SubscribeOutcome> {
  const gateway = deps.gateway ?? liveNewsletterGateway();
  const now = deps.now ?? (() => new Date());

  // 1. Honeypot. A filled hidden field is a bot; drop it silently with a success-shaped
  //    answer so the bot learns nothing.
  if (input.honeypot !== null && input.honeypot.trim() !== '') {
    return { status: 'ok' };
  }

  // 2. Shape. A malformed address is rejected before any work; a valid one is normalised.
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) {
    return { status: 'invalid', reason: 'email_format' };
  }
  const normalized = normalizeEmailAddress(email);

  // 3. Rate limit, by HMAC'd IP. Fails open only when no salt is configured (no IP evidence
  //    to key on) — the honeypot and Turnstile still apply in that case.
  const ipHmac = hashIp(input.ip);
  if (ipHmac !== null) {
    const since = new Date(now().getTime() - RATE_LIMIT.windowSeconds * 1000).toISOString();
    const attempts = await gateway.countRecentAttempts(ipHmac, since);
    if (attempts >= RATE_LIMIT.max) {
      await gateway.recordAttempt(ipHmac, 'rate_limited');
      return { status: 'rate_limited' };
    }
    await gateway.recordAttempt(ipHmac, 'attempt');
  }

  // 4. Turnstile. Skipped cleanly when unconfigured (see turnstile.ts); a hard fail when it
  //    is configured and the token is missing or invalid.
  const verify = deps.verify ?? verifyTurnstile;
  const turnstile = await verify(input.turnstileToken, input.ip, deps.fetchImpl ?? fetch);
  if (!turnstile.ok) {
    return { status: 'blocked', reason: turnstile.reason };
  }

  // 5. Look up by the normalised address, so "a@gmail.com" and "a+x@gmail.com" are one person.
  const existing = await gateway.findSubscriber(normalized);

  // An already-active subscriber gets the neutral answer and NO email — re-confirming an
  // active address would be an unrequested message.
  if (existing?.status === 'active') {
    return { status: 'ok' };
  }

  const token = generateToken();
  const confirmUrl = absoluteUrl(`/api/newsletter/confirm?token=${encodeURIComponent(token)}`);
  const confirmExpires = new Date(now().getTime() + CONFIRM_TTL_HOURS * 3600 * 1000).toISOString();

  const consent = {
    confirm_token_hash: hashToken(token),
    confirm_sent_at: now().toISOString(),
    confirm_expires_at: confirmExpires,
    consent_text_version: CONSENT_TEXT_VERSION,
    consent_ip_hmac: ipHmac,
    consent_user_agent: input.userAgent,
    signup_source: input.source,
  };

  if (existing === null) {
    // New address. The unsubscribe token is a deterministic HMAC of the row id, so it needs
    // the id first: insert with a placeholder hash, then set the real one. A temporary
    // random placeholder means the NOT NULL column is never briefly wrong in a usable way.
    const insertedId = await gateway.insertPending({
      email,
      unsubscribe_token_hash: hashToken(generateToken()),
      ...consent,
    });
    if (insertedId === null) {
      // A unique conflict means a concurrent request created the row; treat as success.
      return { status: 'ok' };
    }
    await gateway.setUnsubscribeHash(insertedId, unsubscribeTokenHash(insertedId));
  } else {
    // A pending, unsubscribed or bounced row: re-arm the confirmation and re-send. A fresh
    // token invalidates any older link.
    await gateway.rearmPending(existing.id, consent);
  }

  // Send the confirmation. A delivery failure is logged but does not change the neutral
  // response — the row is captured and the person can retry, and a missing provider is a
  // clean `not_configured` rather than a throw (see provider.ts).
  const provider = deps.provider ?? createEmailProvider(deps.fetchImpl);
  const message = confirmEmail({ confirmUrl });
  const result = await provider.send({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (result.outcome !== 'sent') {
    await gateway.logSendFailure(
      result.outcome === 'not_configured' ? 'warn' : 'error',
      result.error,
    );
  }

  return { status: 'ok' };
}

export const CONFIRM_REDIRECT = routes.newsletterConfirmed();
