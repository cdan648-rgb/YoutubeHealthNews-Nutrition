import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    // Pinned so a machine's local timezone can never make a date test pass or
    // fail spuriously. Vercel runs in UTC; this makes local runs match.
    env: { TZ: 'UTC' },
  },
});
