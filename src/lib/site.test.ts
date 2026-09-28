/**
 * Site-config invariants, guarding a real CI regression.
 *
 * `SITE.url` feeds `new URL(SITE.url)` in the root layout's `metadataBase`. GitHub Actions
 * injects an unset repository variable as an EMPTY STRING, and `'' ?? fallback` keeps the
 * empty string — which made `next build` fail with `Invalid URL` while collecting the admin
 * route. `publicEnv` coalesces empty to the fallback; these tests pin that so the trap
 * cannot come back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { publicEnv, SITE } from './site';

describe('publicEnv', () => {
  const KEY = 'TEST_PUBLIC_ENV_VAR';
  afterEach(() => {
    delete process.env[KEY];
  });

  it('uses the value when set', () => {
    process.env[KEY] = 'https://example.com';
    expect(publicEnv(KEY, 'fallback')).toBe('https://example.com');
  });

  it('falls back when undefined', () => {
    delete process.env[KEY];
    expect(publicEnv(KEY, 'fallback')).toBe('fallback');
  });

  it('falls back when the EMPTY STRING — the GitHub Actions unset-variable case', () => {
    // This is the exact regression: `'' ?? fallback` would keep '', but publicEnv must not.
    process.env[KEY] = '';
    expect(publicEnv(KEY, 'fallback')).toBe('fallback');
  });
});

describe('SITE.url', () => {
  it('is always a valid absolute URL — never the empty string', () => {
    expect(SITE.url).not.toBe('');
    // The construction that broke the build; it must never throw.
    expect(() => new URL(SITE.url)).not.toThrow();
  });

  it('has no trailing slash, so absolute URLs concatenate cleanly', () => {
    expect(SITE.url.endsWith('/')).toBe(false);
  });
});
