import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { markSession } from '../browser/profiles';

const ACTOR = 'founder';

/** Which accounts can publish through a signed-in browser, and the switch that turns it on (S5-3). Logging in is done by hand with `pnpm run browser:login`. */
export function browserRoutes() {
  const r = new Hono<AppEnv>();

  r.get('/accounts', async (c) => {
    const rows = await c.get('tx').client.query<{ id: string; channel: string; handle: string; transport: string; browser_profile: string | null; session_state: string; session_checked_at: Date | null }>(
      'select id, channel, handle, transport, browser_profile, session_state, session_checked_at from channel_accounts order by channel, handle',
    );
    return c.json(rows.rows.map((a) => ({ id: a.id, channel: a.channel, handle: a.handle, transport: a.transport, hasProfile: a.browser_profile !== null, sessionState: a.session_state, sessionCheckedAt: a.session_checked_at?.toISOString() ?? null })));
  });

  r.post('/accounts/:id/transport', async (c) => {
    const parsed = z.object({ transport: z.enum(['outbox', 'browser']) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'transport must be "outbox" or "browser".' }, 400);
    const tx = c.get('tx').client;
    const id = c.req.param('id');
    if (!z.uuid().safeParse(id).success) return c.json({ error: 'Not found' }, 404);
    const a = (await tx.query<{ handle: string; transport: string; browser_profile: string | null; session_state: string }>('select handle, transport, browser_profile, session_state from channel_accounts where id = $1 for update', [id])).rows[0];
    if (!a) return c.json({ error: 'Not found' }, 404);
    if (parsed.data.transport === 'browser') {
      if (!a.browser_profile) return c.json({ error: `${a.handle} has no browser profile yet. Log in once by hand with: pnpm run browser:login ${a.handle}` }, 409);
      if (a.session_state !== 'valid') return c.json({ error: `The login for ${a.handle} is not known to be valid (${a.session_state}). Log in again with: pnpm run browser:login ${a.handle}` }, 409);
    }
    await tx.query('update channel_accounts set transport = $2 where id = $1', [id, parsed.data.transport]);
    await tx.query("insert into audit_log (workspace_id, actor, action, subject, data) values ((select workspace_id from channel_accounts where id = $1), $2, 'account.transport_changed', $1, $3)", [id, ACTOR, JSON.stringify({ from: a.transport, to: parsed.data.transport })]);
    return c.json({ id, transport: parsed.data.transport });
  });

  r.post('/accounts/:id/session', async (c) => {
    const parsed = z.object({ state: z.enum(['valid', 'expired']) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'state must be "valid" or "expired".' }, 400);
    const id = c.req.param('id');
    if (!z.uuid().safeParse(id).success) return c.json({ error: 'Not found' }, 404);
    const ws = (await c.get('tx').client.query<{ workspace_id: string }>('select workspace_id from channel_accounts where id = $1', [id])).rows[0]?.workspace_id;
    if (!ws || !(await markSession(c.get('tx').client, ws, id, parsed.data.state, ACTOR))) return c.json({ error: 'Not found' }, 404);
    return c.json({ id, sessionState: parsed.data.state });
  });

  return r;
}
