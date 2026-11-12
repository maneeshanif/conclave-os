import { defineConfig } from 'drizzle-kit';

// Used only to generate migrations: `pnpm --filter @conclave/server db:generate`.
// Migrations are applied by src/db/migrate.ts, as the owner role.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
});
