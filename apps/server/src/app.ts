import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { UpgradeWebSocket } from 'hono/ws';
import type { Pool } from 'pg';
import { HealthSchema } from '@conclave/shared';
import type { Auth, SessionInfo } from './auth';
import type { Bus } from './bus';
import { withWorkspace, type Tx } from './db/tenant';
import type { OsStore } from './harness/os-tools';
import type { RunTokens } from './harness/run-tokens';
import { apiRoutes } from './routes/api';
import type { ApprovalDecision } from './routes/approvals';
import { mcpRoutes } from './routes/mcp';
import { ownerRoutes } from './routes/owner';
import type { Dispatcher } from './workflows/dispatch';

/** `tx` is the request's transaction. `after` holds work that must wait until it commits, such as starting a run. */
export type AppEnv = { Variables: { tx: Tx; after: (() => Promise<void>)[]; owner?: SessionInfo } };

export interface AppDeps {
  pool: Pool;
  /** Local mode has one workspace. Team mode will resolve it per request. */
  workspaceId: string;
  tokens?: RunTokens;
  store?: OsStore;
  bus?: Bus;
  dispatcher?: Dispatcher;
  upgradeWebSocket?: UpgradeWebSocket;
  inngestHandler?: (c: Context) => Promise<Response>;
  /** Browser origins allowed to call the API. Only the local web app. */
  webOrigins?: string[];
  /**
   * Host headers the server answers to, such as `127.0.0.1:3100`. Anything else is refused, which
   * stops DNS rebinding: a page on evil.example resolved to 127.0.0.1 still sends `Host: evil.example`.
   */
  hosts?: string[];
  /**
   * The login wall (S1-10). When set, every /api route and the event socket need a signed-in session; only the
   * sign-in routes under /api/auth, the health check, the agents' own run-token endpoint and Inngest stay open.
   */
  auth?: Auth;
  /** Called after an approval decision has committed. The gate (S1-3) starts the executor from here. */
  onApprovalDecided?: (d: ApprovalDecision) => Promise<void> | void;
  /** Called after the kill switch changes. On means stop what is running and drop what is queued. */
  onKillSwitch?: (on: boolean) => Promise<void> | void;
  /** Sends the approved emails the kill switch or a cap was holding. Returns how many it tried. */
  onReleaseHeld?: () => Promise<number> | number;
}

/**
 * Without `deps` the app has no database, which is all the health check needs.
 * With them, every `/api` route runs inside one transaction that starts with `set local app.workspace_id`,
 * available as `c.get('tx')`. The MCP endpoint, the event socket and Inngest open their own short
 * transactions instead, because they can stay open for minutes.
 */
export function createApp(deps?: AppDeps) {
  const app = new Hono<AppEnv>();

  // Registered before the transaction middleware on purpose: a health check answers without a database.
  app.get('/health', (c) => c.json(HealthSchema.parse({ ok: true })));
  if (!deps) return app;

  const origins = deps.webOrigins ?? ['http://127.0.0.1:3000', 'http://localhost:3000', ...(deps.auth ? [deps.auth.config.webOrigin] : [])];

  // CORS headers alone do not stop a request: a page can still POST text/plain with no preflight.
  // So refuse, in code, a wrong Host, a foreign Origin on anything that changes state, and a write
  // that is not JSON (which forces a browser preflight that the CORS rules then answer).
  app.use('*', async (c, next) => {
    if (deps.hosts && !deps.hosts.includes(c.req.header('host') ?? new URL(c.req.url).host)) return c.json({ error: 'Unknown host.' }, 403);
    const p = c.req.path;
    const writes = c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS';
    if (writes && (p.startsWith('/api') || p.startsWith('/inngest'))) {
      const origin = c.req.header('origin');
      if (origin && !origins.includes(origin)) return c.json({ error: 'Origin not allowed.' }, 403);
      if (p.startsWith('/api') && !(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
        return c.json({ error: 'Send JSON.' }, 415);
      }
    }
    if (c.req.method === 'GET' && p === '/events') {
      const origin = c.req.header('origin');
      if (origin && !origins.includes(origin)) return c.json({ error: 'Origin not allowed.' }, 403);
    }
    await next();
  });
  app.use('/api/*', cors({ origin: origins, allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'], allowHeaders: ['content-type'], credentials: true }));
  if (deps.auth) {
    const auth = deps.auth;
    // Sign-in comes first: it answers without a session and without a database transaction.
    app.all('/api/auth/*', (c) => auth.handler(c.req.raw));
    const wall = async (c: Context<AppEnv>, next: () => Promise<void>) => {
      const me = await auth.session(c.req.raw.headers).catch(() => null);
      if (!me) return c.json({ error: 'Sign in first.' }, 401);
      c.set('owner', me);
      await next();
    };
    app.use('/api/*', wall);
    app.use('/events', wall);
  }
  app.use('/api/*', async (c, next) => {
    const after: (() => Promise<void>)[] = [];
    c.set('after', after);
    await withWorkspace(deps.pool, deps.workspaceId, async (tx) => {
      c.set('tx', tx);
      await next();
      // Hono turns a handler's error into a 500 response instead of throwing, so look for it here.
      // Throwing rolls the transaction back.
      if (c.error) throw c.error;
    });
    for (const fn of after) await fn();
  });

  if (deps.auth) app.route('/api/owner', ownerRoutes({ auth: deps.auth }));
  if (deps.bus && deps.dispatcher) {
    app.route('/api', apiRoutes({ workspaceId: deps.workspaceId, dispatcher: deps.dispatcher, bus: deps.bus, onApprovalDecided: deps.onApprovalDecided, onKillSwitch: deps.onKillSwitch, onReleaseHeld: deps.onReleaseHeld }));
  }
  if (deps.tokens && deps.store) app.route('/mcp', mcpRoutes({ tokens: deps.tokens, store: deps.store }));
  if (deps.inngestHandler) app.on(['GET', 'POST', 'PUT'], '/inngest', deps.inngestHandler);

  if (deps.upgradeWebSocket && deps.bus) {
    const ws = deps.workspaceId;
    const bus = deps.bus;
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
            off = bus.subscribe((m) => {
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

export const app = createApp();
