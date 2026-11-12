import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['apps/*/test/**/*.test.{ts,tsx}', 'packages/*/test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
