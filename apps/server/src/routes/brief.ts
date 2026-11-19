import { Hono } from 'hono';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import { briefOn, latestBrief, rebuildBrief, toRecord } from '../brief/build';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The morning brief (SPEC 3, 12). A brief is a record, one per day, built from the tables by plain code and kept as it was
 * when it was built: reading it later shows that morning, and `rebuild` is how today's numbers are refreshed. The chief of
 * staff's paragraph is stored beside the numbers, labelled as the agent's, and never changes them.
 */
export function briefRoutes(deps: { workspaceId: string; bus: Bus }) {
  const r = new Hono<AppEnv>();

  r.get('/brief', async (c) => {
    const b = await latestBrief(c.get('tx').client);
    return b ? c.json(b) : c.json({ error: 'There is no brief yet. It is made each morning, or ask for one now.' }, 404);
  });

  r.post('/brief/rebuild', async (c) => {
    const b = await rebuildBrief(c.get('tx').client, deps.workspaceId, new Date());
    return c.json(b, 201);
  });

  r.get('/briefs', async (c) => {
    const rows = await c.get('tx').client.query("select to_char(day, 'YYYY-MM-DD') as day, quiet, summary, narrative is not null as has_narrative from briefs order by day desc limit 60");
    return c.json(rows.rows);
  });

  r.get('/brief/:day', async (c) => {
    const day = c.req.param('day') as string;
    if (!DAY.test(day)) return c.json({ error: 'Write the day as YYYY-MM-DD.' }, 400);
    const b = await briefOn(c.get('tx').client, day);
    return b ? c.json(b) : c.json({ error: 'There is no brief for that day.' }, 404);
  });

  return r;
}

export { toRecord };
