import { Hono } from 'hono';
import type { Auth, SessionInfo } from '../auth';
import type { AppEnv } from '../app';

/**
 * The owner's own pages of the API (S1-10): make a one-time code for a new device, list the signed-in devices,
 * sign one out. Only reachable with a session, because the login wall sits in front of every /api route.
 */
export function ownerRoutes(deps: { auth: Auth }) {
  const r = new Hono<AppEnv>();
  const who = (c: { get: (k: 'owner') => SessionInfo | undefined }) => c.get('owner');

  r.post('/codes', async (c) => {
    const me = who(c);
    if (!me) return c.json({ error: 'Sign in first.' }, 401);
    const code = await deps.auth.issueEnrolCode(me.userId);
    return c.json({ code, validForMinutes: 15 });
  });

  r.get('/devices', async (c) => {
    const me = who(c);
    if (!me) return c.json({ error: 'Sign in first.' }, 401);
    return c.json(await deps.auth.devices(me));
  });

  r.delete('/devices/:id', async (c) => {
    const me = who(c);
    if (!me) return c.json({ error: 'Sign in first.' }, 401);
    return (await deps.auth.revokeDevice(me.userId, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
  });

  return r;
}
