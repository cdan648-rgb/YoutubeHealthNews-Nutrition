import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
