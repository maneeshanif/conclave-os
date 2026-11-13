import { Hono } from 'hono';
import type { AppEnv } from '../app';
import type { Breakers } from '../harness/breakers';

/** Circuit breakers (S3-6): what is open, and the founder's reset once the cause is fixed. */
export function breakerRoutes(deps: { breakers: Breakers }) {
  const r = new Hono<AppEnv>();

  r.get('/', async (c) => c.json((await deps.breakers.list()).map((b) => ({ ...b, opened_at: b.opened_at?.toISOString() ?? null, open_until: b.open_until?.toISOString() ?? null }))));

  // The key is written tool-by-tool, such as os:add_lead.
  r.post('/:key/reset', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    return (await deps.breakers.reset(key, 'founder')) ? c.json({ key, reset: true }) : c.json({ error: `${key} is not open.` }, 404);
  });

  return r;
}
