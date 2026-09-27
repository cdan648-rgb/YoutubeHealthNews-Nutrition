/**
 * The email provider: the disabled default and the Resend mapping.
 *
 * No test sends a real email — the Resend provider is driven with a fetch stub, and
 * `createEmailProvider` with no env returns the disabled provider. This is the discipline
 * that keeps `npm test` from ever touching a mailbox.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailProvider, createResendProvider } from './provider';

const MESSAGE = { to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' } as const;

describe('disabled provider', () => {
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  it('is returned when Resend env is absent, and fails cleanly', async () => {
    delete process.env.RESEND_API_KEY;
    const provider = createEmailProvider();
    expect(provider.configured).toBe(false);
    const result = await provider.send(MESSAGE);
    expect(result.outcome).toBe('not_configured');
  });
});

describe('Resend provider', () => {
  it('maps a 200 to sent with the message id', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 })),
    ) as unknown as typeof fetch;
    const provider = createResendProvider({ apiKey: 'k', from: 'x@y.z', fetchImpl });
    const result = await provider.send(MESSAGE);
    expect(result).toEqual({ outcome: 'sent', providerMessageId: 'msg_123' });
  });

  it('maps a non-2xx to a failure with detail', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('quota', { status: 429 }))) as unknown as typeof fetch;
    const provider = createResendProvider({ apiKey: 'k', from: 'x@y.z', fetchImpl });
    const result = await provider.send(MESSAGE);
    expect(result.outcome).toBe('failed');
    if (result.outcome === 'failed') expect(result.error).toContain('429');
  });

  it('sets the RFC 8058 one-click headers and the idempotency key', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = ((_url: unknown, init?: RequestInit) => {
      captured = init;
      return Promise.resolve(new Response(JSON.stringify({ id: 'm' }), { status: 200 }));
    }) as unknown as typeof fetch;

    await createResendProvider({ apiKey: 'k', from: 'x@y.z', fetchImpl }).send({
      ...MESSAGE,
      listUnsubscribeUrl: 'https://site/api/newsletter/unsubscribe?u=1&t=z',
      listUnsubscribePost: true,
      idempotencyKey: 'send-1',
    });

    const headers = (captured?.headers ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('send-1');
    const body = JSON.parse(typeof captured?.body === 'string' ? captured.body : '{}') as {
      headers?: Record<string, string>;
    };
    expect(body.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(body.headers?.['List-Unsubscribe']).toContain('unsubscribe');
  });
});
