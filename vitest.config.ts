import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws on import outside a React Server Component context, which is
      // exactly what it is for — but it makes server modules untestable under Vitest.
      // Stubbing it here does not weaken the guarantee: the guard's real job is to fail
      // the Next.js *client* bundle build, and that still happens.
      'server-only': fileURLToPath(new URL('./tests/helpers/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    // Pinned so a machine's local timezone can never make a date test pass or fail
    // spuriously. Vercel runs in UTC; this makes local runs match.
    env: { TZ: 'UTC' },
  },
});
