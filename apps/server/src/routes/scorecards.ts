import { Hono } from 'hono';
import type { Pool } from 'pg';
import type { AppEnv } from '../app';
import { weeklyScorecards } from '../talent/scorecards';

/** The weekly scorecards (S8-7, S8-8): read only, counted from the tables. `?days=` is 1 to 90, default 7. */
export function scorecardRoutes(deps: { workspaceId: string; pool: Pool }) {
  const r = new Hono<AppEnv>();
  r.get('/', async (c) => {
    const raw = c.req.query('days');
    const days = raw === undefined ? 7 : Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 90) return c.json({ error: 'days is a whole number from 1 to 90' }, 400);
    return c.json({ days, scorecards: await weeklyScorecards(deps.pool, deps.workspaceId, { since: new Date(Date.now() - days * 86_400_000) }) });
  });
  return r;
}
