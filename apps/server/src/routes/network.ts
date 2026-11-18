import { Hono } from 'hono';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { markSentByYou } from '../network/network';

const Sent = z.object({ nudgeInDays: z.number().int().min(1).max(365).optional() }).strict();

/** The Founder Network (S8-11b): who, with their drafts and touches. The only write is you saying you sent a draft yourself. */
export function networkRoutes(deps: { workspaceId: string; pool: Pool }) {
  const r = new Hono<AppEnv>();
  r.get('/', async (c) => {
    const tx = c.get('tx').client;
    const people = (await tx.query<{ id: string; name: string; where_found: string; note: string; status: string; last_touch: Date | null; next_nudge: string | null }>('select id, name, where_found, note, status, last_touch, next_nudge from network_people order by name')).rows;
    const drafts = (await tx.query<{ id: string; person_id: string; text: string; status: string }>("select id, person_id, text, status from network_drafts order by created_at")).rows;
    return c.json({
      people: people.map((p) => ({ id: p.id, name: p.name, whereFound: p.where_found, note: p.note, status: p.status, lastTouch: p.last_touch?.toISOString() ?? null, nextNudge: p.next_nudge, drafts: drafts.filter((d) => d.person_id === p.id).map((d) => ({ id: d.id, text: d.text, status: d.status })) })),
    });
  });
  r.post('/drafts/:id/sent', async (c) => {
    const parsed = Sent.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    const out = await markSentByYou(deps.pool, deps.workspaceId, c.req.param('id'), parsed.data.nudgeInDays).catch(() => 'not_found' as const);
    if (out === 'not_found') return c.json({ error: 'No such draft.' }, 404);
    if (out === 'already') return c.json({ error: 'That draft is already marked as sent.' }, 409);
    return c.json({ ok: true });
  });
  return r;
}
