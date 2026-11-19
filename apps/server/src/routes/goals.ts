import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { measureGoals } from '../goals/progress';

/**
 * The Goals screen's data (SPEC 3, 12). Read-only: the goals are the company file's (company/goals.yaml, copied into the
 * database when the server starts), so a change is an edit there, the same as for departments and agents. Progress is
 * measured from the tables by the metrics in src/goals/metrics.ts.
 */
export function goalRoutes() {
  const r = new Hono<AppEnv>();
  r.get('/goals', async (c) => c.json(await measureGoals(c.get('tx').client, new Date())));
  return r;
}
