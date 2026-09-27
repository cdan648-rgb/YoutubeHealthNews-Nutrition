/**
 * Vitest stand-in for the `server-only` package.
 *
 * The real package throws on import to prevent a server module reaching a client bundle.
 * That protection is a build-time concern for Next.js, and it still applies there; under
 * Vitest the throw would simply make every server module untestable.
 */
export {};
