import { Hono } from 'hono';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { closeMeeting, MeetingStateError, openMeeting, selectMeetingConnector, type MeetingConnector } from '../meetings/connector';

const New = z.object({ title: z.string().trim().min(1).max(200), startsAt: z.iso.datetime(), dealId: z.uuid().optional() }).strict();

/** Client meetings (S10-3, S10-7): the list, making one, and opening and closing its room. Guest links are made by an approved invite, never here. */
export function meetingRoutes(deps: { workspaceId: string; pool: Pool; connector?: MeetingConnector }) {
  const r = new Hono<AppEnv>();
  const connector = deps.connector ?? selectMeetingConnector(process.env.MEETING_CONNECTOR);

  r.get('/', async (c) => {
    const rows = await c.get('tx').client.query<{ id: string; title: string; starts_at: Date; status: string; room: string | null; deal_id: string | null; invites: number }>(
      `select m.id, m.title, m.starts_at, m.status, m.room, m.deal_id,
              (select count(*)::int from guest_links g where g.meeting_id = m.id and g.revoked_at is null and g.expires_at > now()) as invites
         from meetings m order by m.starts_at desc, m.id limit 200`,
    );
    return c.json({ meetings: rows.rows.map((m) => ({ id: m.id, title: m.title, startsAt: m.starts_at.toISOString(), status: m.status, room: m.room, dealId: m.deal_id, invites: m.invites })) });
  });

  r.post('/', async (c) => {
    const parsed = New.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    const tx = c.get('tx').client;
    if (parsed.data.dealId && !(await tx.query('select 1 from deals where id = $1', [parsed.data.dealId])).rows[0]) return c.json({ error: 'There is no such deal.' }, 400);
    const row = await tx.query<{ id: string }>('insert into meetings (workspace_id, deal_id, title, starts_at) values (current_setting(\'app.workspace_id\')::uuid, $1, $2, $3) returning id', [parsed.data.dealId ?? null, parsed.data.title, parsed.data.startsAt]);
    return c.json({ id: row.rows[0]!.id }, 201);
  });

  for (const action of ['open', 'close'] as const) {
    r.post(`/:id/${action}`, async (c) => {
      const id = c.req.param('id');
      try {
        const out = action === 'open' ? await openMeeting(deps.pool, deps.workspaceId, connector, id) : await closeMeeting(deps.pool, deps.workspaceId, connector, id);
        return c.json(out);
      } catch (err) {
        if (err instanceof MeetingStateError) return c.json({ error: err.message }, 409);
        return c.json({ error: (err as Error).message }, 502);
      }
    });
  }
  return r;
}
