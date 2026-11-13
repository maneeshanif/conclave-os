import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    // Clears stale conclave-* temp folders and stops early with a clear message if the disk is nearly full (S3-12).
    globalSetup: ['./vitest.global-setup.ts'],
    include: ['apps/*/test/**/*.test.{ts,tsx}', 'packages/*/test/**/*.test.ts'],
    passWithNoTests: true,
    // Database tests start a real embedded Postgres, so the first start is slow.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Most test files start their own embedded Postgres. With a worker per core (12 here) the machine is so loaded that the
    // database start-up tests miss their time limits, so fewer files run at once.
    maxWorkers: 5,
  },
});
