/**
 * Cloudflare Turnstile verification. SERVER ONLY.
 *
 * Turnstile is a bot check, and it degrades cleanly by design: if `TURNSTILE_SECRET_KEY`
 * is not configured, verification is SKIPPED rather than failing every signup. That is the
 * right default for a project that can be deployed before its captcha keys exist — the
 * honeypot and the IP rate limit still apply, so the endpoint is never defenceless — and
 * the skip is reported so the caller can log that the site is running without it.
 *
 * When the key IS configured, a missing or invalid token is a hard rejection. There is no
 * middle setting: either the check runs and must pass, or it is absent and says so.
 */
import 'server-only';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult =
  | { readonly ok: true; readonly skipped: boolean }
  | { readonly ok: false; readonly reason: string };

export async function verifyTurnstile(
  token: string | null,
  remoteIp: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret === undefined || secret === '') {
    return { ok: true, skipped: true };
  }
  if (token === null || token === '') {
    return { ok: false, reason: 'missing_token' };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp !== null && remoteIp !== '') body.set('remoteip', remoteIp);

  let response: Response;
  try {
    response = await fetchImpl(VERIFY_URL, { method: 'POST', body });
  } catch (cause) {
    // A verification-service outage should not silently let bots through, so this fails
    // closed — the signup can be retried when Cloudflare is reachable again.
    return {
      ok: false,
      reason: `verify_unreachable: ${cause instanceof Error ? cause.message : 'error'}`,
    };
  }

  if (!response.ok) return { ok: false, reason: `verify_http_${response.status}` };

  const outcome = (await response.json()) as { success?: boolean; 'error-codes'?: string[] };
  if (outcome.success === true) return { ok: true, skipped: false };
  return { ok: false, reason: (outcome['error-codes'] ?? ['failed']).join(',') };
}
