import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    passWithNoTests: true,
    // Database tests start a real embedded Postgres, so the first start is slow.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
