import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { buildHealth, type ReaperStatus } from '../health';

/** The Health screen's data (S3-7). Read-only; the actions it offers (kill switch, resets, lifting a pause) are the existing routes. */
export function healthRoutes(deps: { reaper?: ReaperStatus }) {
  const r = new Hono<AppEnv>();
  r.get('/health/overview', async (c) => {
    const raw = c.req.query('hours');
    const hours = raw === undefined ? 24 : Number(raw);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) return c.json({ error: 'hours must be a whole number from 1 to 720.' }, 400);
    return c.json(await buildHealth(c.get('tx').client, { hours, ...(deps.reaper ? { reaper: deps.reaper } : {}) }));
  });
  return r;
}
