import { defineConfig } from 'vitest/config';

// Browser checks that need a production build of the web app. Run with: pnpm run e2e:mobile
export default defineConfig({
  test: { include: ['apps/web/e2e/**/*.e2e.ts'], testTimeout: 60_000, hookTimeout: 240_000, fileParallelism: false },
});
