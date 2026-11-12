import { Hono } from 'hono';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import { liftPause, RUNTIME_LABEL } from '../harness/pauses';

/**
 * Runtimes paused for a plan limit (S3-3). Reading is open to the app; lifting early is the founder's call, for example
 * after upgrading the plan. The pause lifts itself at the reset time on its own.
 */
export function pauseRoutes(deps: { workspaceId: string; bus: Bus }) {
  const r = new Hono<AppEnv>();

  r.get('/runtime-pauses', async (c) => {
    const rows = await c.get('tx').client.query<{ runtime: string; until: Date; reason: string; created_at: Date }>(
      'select runtime, until, reason, created_at from runtime_pauses where lifted_at is null and until > now() order by until',
    );
    return c.json(rows.rows.map((p) => ({ runtime: p.runtime, label: RUNTIME_LABEL[p.runtime] ?? p.runtime, until: p.until.toISOString(), reason: p.reason, since: p.created_at.toISOString() })));
  });

  r.post('/runtime-pauses/:runtime/lift', async (c) => {
    const runtime = c.req.param('runtime') as string;
    const done = await liftPause(c.get('tx').client, deps.workspaceId, runtime, 'founder');
    if (!done) return c.json({ error: `${runtime} is not paused.` }, 404);
    c.get('after').push(async () => deps.bus.publish({ kind: 'settings.changed', workspaceId: deps.workspaceId }));
    return c.json({ runtime, lifted: true });
  });

  return r;
}
