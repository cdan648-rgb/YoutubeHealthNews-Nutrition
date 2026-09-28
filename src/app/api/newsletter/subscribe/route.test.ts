/**
 * The subscribe route's failure-mode contract.
 *
 * The production bug we are guarding against was a thrown Supabase error
 * ("Invalid schema: internal") bubbling to Next.js's raw HTML 500 page, which the mobile
 * modal's fetch could only report as the generic "invalid or unverifiable" message. The fix
 * has two halves: the underlying DB call was moved onto a public-schema RPC (elsewhere),
 * and this route now catches ANY thrown error and returns a controlled response. This test
 * asserts the second half — even if the gateway throws, the route answers JSON or a
 * redirect, never HTML with a stack trace.
 */
import { describe, expect, it, vi } from 'vitest';

// The route imports `subscribe` — we replace it with a controllable stub.
const subscribeStub = vi.fn();
vi.mock('@/lib/newsletter/subscribe', () => ({
  subscribe: subscribeStub,
}));

// Then import the route AFTER the mock is in place.
const { POST } = await import('./route');

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request('https://example.test/api/newsletter/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

function formRequest(email: string): Request {
  const form = new URLSearchParams({ email });
  return new Request('https://example.test/api/newsletter/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

describe('POST /api/newsletter/subscribe', () => {
  it('returns 200 JSON on the happy path', async () => {
    subscribeStub.mockResolvedValueOnce({ status: 'ok' });
    const response = await POST(jsonRequest({ email: 'reader@gmail.com' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('returns 400 JSON for an invalid outcome — never a 500', async () => {
    subscribeStub.mockResolvedValueOnce({ status: 'invalid', reason: 'email_format' });
    const response = await POST(jsonRequest({ email: 'not-an-email' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: 'invalid', reason: 'email_format' });
  });

  it('returns 429 JSON when rate-limited', async () => {
    subscribeStub.mockResolvedValueOnce({ status: 'rate_limited' });
    const response = await POST(jsonRequest({ email: 'reader@gmail.com' }));
    expect(response.status).toBe(429);
  });

  it('returns a controlled 503 JSON when the subscribe path throws (the production bug)', async () => {
    subscribeStub.mockRejectedValueOnce(new Error('Invalid schema: internal'));
    const response = await POST(jsonRequest({ email: 'reader@gmail.com' }));
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ status: 'error', reason: 'server_error' });
  });

  it('redirects (never 500s) when the no-JS form hits a thrown error', async () => {
    subscribeStub.mockRejectedValueOnce(new Error('boom'));
    const response = await POST(formRequest('reader@gmail.com'));
    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('state=error');
    expect(location).toContain('reason=server_error');
  });

  it('redirects on a happy no-JS form submission', async () => {
    subscribeStub.mockResolvedValueOnce({ status: 'ok' });
    const response = await POST(formRequest('reader@gmail.com'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location') ?? '').toContain('state=check-email');
  });
});
