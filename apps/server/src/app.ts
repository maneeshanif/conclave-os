import { Hono } from 'hono';
import type { Pool } from 'pg';
import { HealthSchema } from '@conclave/shared';
import { withWorkspace, type Tx } from './db/tenant';

export type AppEnv = { Variables: { tx: Tx } };

export interface AppDeps {
  pool: Pool;
  /** Local mode has one workspace. Team mode will resolve it per request. */
  workspaceId: string;
}

/**
 * Without `deps` the app has no database, which is all the health check needs.
 * With them, every route registered after this point runs inside one transaction that starts with
 * `set local app.workspace_id`, available as `c.get('tx')`.
 */
export function createApp(deps?: AppDeps) {
  const app = new Hono<AppEnv>();

  // Registered before the transaction middleware on purpose: a health check answers without a database.
  app.get('/health', (c) => c.json(HealthSchema.parse({ ok: true })));

  if (deps) {
    app.use('*', async (c, next) => {
      await withWorkspace(deps.pool, deps.workspaceId, async (tx) => {
        c.set('tx', tx);
        await next();
        // Hono turns a handler's error into a 500 response instead of throwing, so look for it here.
        // Throwing rolls the transaction back.
        if (c.error) throw c.error;
      });
    });
  }

  return app;
}

export const app = createApp();
