import type { NextConfig } from 'next';

/**
 * Content Security Policy.
 *
 * Built from exactly what the site loads and nothing more:
 *   - images from ourselves and YouTube's thumbnail host (heroes are hotlinked ytimg URLs);
 *   - frames only from the youtube-nocookie player and the Turnstile challenge;
 *   - the Turnstile script from Cloudflare; everything else is same-origin.
 *
 * `script-src` and `style-src` keep 'unsafe-inline': Next's App Router injects inline
 * hydration/bootstrap scripts and the framework's inline styles, and a nonce scheme would
 * need middleware on every route. This is the pragmatic, widely-used posture; the higher-value
 * protections here are `object-src 'none'`, `frame-ancestors 'none'` (clickjacking) and a
 * tight `connect-src` — the browser never calls Supabase or any third party directly, so
 * same-origin is the whole surface.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://i.ytimg.com https://*.ytimg.com",
  "font-src 'self'",
  "connect-src 'self' https://challenges.cloudflare.com",
  'frame-src https://www.youtube-nocookie.com https://www.youtube.com https://challenges.cloudflare.com',
  'upgrade-insecure-requests',
].join('; ');

/** Applied to every response. Static, so they cost nothing per request. */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    // A year, with preload. Vercel serves HTTPS, so there is no HTTP the site should work on.
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },

  // Article heroes reference YouTube's own thumbnail URLs directly via a plain
  // <img srcset>. We deliberately do NOT route them through next/image: the
  // optimiser would fetch and cache a derivative copy on our CDN, which is a
  // copy rather than a reference. See plan R29.
  images: {
    remotePatterns: [],
  },

  eslint: {
    // Linting runs as its own CI step; don't double-run it during build.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Typechecking runs as its own CI step.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
