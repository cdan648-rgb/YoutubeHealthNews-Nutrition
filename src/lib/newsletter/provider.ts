/**
 * The email provider seam. SERVER ONLY.
 *
 * One interface, two implementations: Resend for production and whatever a test injects.
 * The pipeline never imports Resend directly, so no test can send a real email — the same
 * discipline the OpenRouter client uses.
 *
 * Resend is optional infrastructure. If `RESEND_API_KEY` / `RESEND_FROM_EMAIL` are not set,
 * `createEmailProvider()` returns a provider that fails every send with a clear, stable
 * `not_configured` outcome rather than throwing. The whole newsletter therefore builds,
 * tests and deploys before the account exists: signups are captured and confirmation is
 * queued, and only the actual send reports that it needs configuration — which is what the
 * admin view and `job_logs` surface. Nothing about the list is lost while the key is absent.
 */
import 'server-only';

export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /**
   * List-Unsubscribe headers (RFC 2369 + RFC 8058).
   *
   * The one-click header is what lets a mail client offer a real unsubscribe button, and it
   * is a POST by definition, so it never collides with the prefetch problem that makes
   * GET-unsubscribe unsafe.
   */
  readonly listUnsubscribeUrl?: string;
  readonly listUnsubscribePost?: boolean;
  /**
   * Per-recipient idempotency key. Resend honours `Idempotency-Key`, but the authoritative
   * guard is our own unique `newsletter_sends` row — this is defence in depth.
   */
  readonly idempotencyKey?: string;
};

export type SendResult =
  | { readonly outcome: 'sent'; readonly providerMessageId: string | null }
  | { readonly outcome: 'failed' | 'not_configured'; readonly error: string };

export type EmailProvider = {
  readonly name: string;
  readonly configured: boolean;
  send(message: EmailMessage): Promise<SendResult>;
};

/** The provider used when Resend is not configured. Every send is a clean, logged no-send. */
const DISABLED_PROVIDER: EmailProvider = {
  name: 'disabled',
  configured: false,
  send: () =>
    Promise.resolve({
      outcome: 'not_configured',
      error: 'RESEND_API_KEY / RESEND_FROM_EMAIL are not set; email delivery is disabled',
    }),
};

type Fetcher = typeof fetch;

/** Resend, over its REST API — no SDK, so nothing new enters the bundle. */
export function createResendProvider(options: {
  readonly apiKey: string;
  readonly from: string;
  readonly fetchImpl?: Fetcher;
}): EmailProvider {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: 'resend',
    configured: true,
    async send(message) {
      const headers: Record<string, string> = {};
      if (message.listUnsubscribeUrl !== undefined) {
        headers['List-Unsubscribe'] = `<${message.listUnsubscribeUrl}>`;
        if (message.listUnsubscribePost === true) {
          headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
        }
      }

      const requestHeaders: Record<string, string> = {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      };
      if (message.idempotencyKey !== undefined) {
        requestHeaders['Idempotency-Key'] = message.idempotencyKey;
      }

      let response: Response;
      try {
        response = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({
            from: options.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
          }),
        });
      } catch (cause) {
        return {
          outcome: 'failed',
          error: cause instanceof Error ? cause.message : 'network error',
        };
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return {
          outcome: 'failed',
          error: `resend HTTP ${response.status}: ${detail.slice(0, 200)}`,
        };
      }

      const parsed = (await response.json().catch(() => ({}))) as { id?: string };
      return { outcome: 'sent', providerMessageId: parsed.id ?? null };
    },
  };
}

/** The provider for the current environment: Resend when configured, disabled otherwise. */
export function createEmailProvider(fetchImpl?: Fetcher): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (apiKey === undefined || apiKey === '' || from === undefined || from === '') {
    return DISABLED_PROVIDER;
  }
  return createResendProvider(
    fetchImpl === undefined ? { apiKey, from } : { apiKey, from, fetchImpl },
  );
}
