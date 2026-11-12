import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { UpgradeWebSocket } from 'hono/ws';
import type pg from 'pg';
import { HealthSchema } from '@conclave/shared';
import type { Bus } from './bus';
import type { OsStore } from './harness/os-tools';
import type { RunTokens } from './harness/run-tokens';
import { apiRoutes } from './routes/api';
import { mcpRoutes } from './routes/mcp';
import type { Dispatcher } from './workflows/dispatch';

export interface AppDeps {
  pool: pg.Pool;
  workspaceId: string;
  tokens: RunTokens;
  store: OsStore;
  bus: Bus;
  dispatcher: Dispatcher;
  upgradeWebSocket?: UpgradeWebSocket;
  inngestHandler?: (c: import('hono').Context) => Promise<Response>;
  /** Origins allowed to call the API from a browser. Only the local web app. */
  webOrigins?: string[];
}

export function createApp(deps?: AppDeps): Hono {
  const app = new Hono();
  app.get('/health', (c) => c.json(HealthSchema.parse({ ok: true })));
  if (!deps) return app;

  const origins = deps.webOrigins ?? ['http://127.0.0.1:3000', 'http://localhost:3000'];
  app.use('/api/*', cors({ origin: origins, allowMethods: ['GET', 'POST', 'PATCH'] }));
  app.route('/api', apiRoutes(deps));
  app.route('/mcp', mcpRoutes({ tokens: deps.tokens, store: deps.store }));
  if (deps.inngestHandler) app.on(['GET', 'POST', 'PUT'], '/api/inngest', deps.inngestHandler);

  if (deps.upgradeWebSocket) {
    const ws = deps.workspaceId;
    app.get(
      '/events',
      deps.upgradeWebSocket((c) => {
        const origin = c.req.header('origin');
        let off: (() => void) | undefined;
        return {
          onOpen(_e, socket) {
            if (origin && !origins.includes(origin)) {
              socket.close(1008, 'origin not allowed');
              return;
            }
            off = deps.bus.subscribe((m) => {
              if (m.workspaceId === ws) socket.send(JSON.stringify(m));
            });
          },
          onClose() {
            off?.();
          },
        };
      }),
    );
  }
  return app;
}

/** The bare app, health only. Kept for the S0-1 health test. */
export const app = createApp();
