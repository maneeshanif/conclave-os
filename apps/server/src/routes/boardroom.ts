import { Hono } from 'hono';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';

const Open = z.object({ kind: z.enum(['standup', 'weekly', 'adhoc']), question: z.string().trim().min(1).max(2000), participants: z.array(z.string().trim().min(1).max(100)).max(20).optional() });
const Decide = z.object({
  title: z.string().trim().min(1).max(200),
  decision: z.string().trim().min(1).max(4000),
  owner: z.string().trim().min(1).max(100).optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  discussionId: z.uuid().optional(),
});

/** The agents (by id) who are in an open discussion: it is for them, or they have taken a turn in it. The office puts them in the Boardroom. */
export async function agentsInDiscussion(c: PoolClient): Promise<Set<string>> {
  const r = await c.query<{ id: string }>(
    `select a.id from agents a where a.status <> 'retired' and (
       exists (select 1 from discussions d where d.status = 'open' and d.participants @> to_jsonb(a.key))
       or exists (select 1 from discussion_turns t join discussions d on d.id = t.discussion_id where d.status = 'open' and t.speaker = a.key))`,
  );
  return new Set(r.rows.map((x) => x.id));
}

/** Discussions in the Boardroom (SPEC 4, S6-10): you open one, agents take turns with checked evidence, you close it. */
export function discussionRoutes(deps: { workspaceId: string; bus: Bus }) {
  const r = new Hono<AppEnv>();
  const changed = (c: import('hono').Context<AppEnv>, id: string) => c.get('after').push(async () => deps.bus.publish({ kind: 'discussion.changed', workspaceId: deps.workspaceId, discussionId: id }));

  r.get('/', async (c) => {
    const rows = await c.get('tx').client.query(
      `select d.id, d.kind, d.question, d.status, d.opened_by, d.participants, d.opened_at, d.closed_at, (select count(*)::int from discussion_turns t where t.discussion_id = d.id) as turns
         from discussions d order by (d.status = 'open') desc, d.opened_at desc limit 50`,
    );
    return c.json({ discussions: rows.rows });
  });

  r.post('/', async (c) => {
    const parsed = Open.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Give a kind (standup, weekly or adhoc) and a question of up to 2000 characters.' }, 400);
    const { kind, question, participants = [] } = parsed.data;
    const tx = c.get('tx').client;
    for (const k of participants) if (!(await tx.query("select 1 from agents where key = $1 and status = 'active'", [k])).rows[0]) return c.json({ error: `There is no active agent "${k}" to include.` }, 400);
    const row = await tx.query<{ id: string }>("insert into discussions (workspace_id, kind, question, opened_by, participants) values ($1, $2, $3, 'founder', $4::jsonb) returning id", [deps.workspaceId, kind, question, JSON.stringify(participants)]);
    const id = row.rows[0]!.id;
    changed(c, id);
    return c.json({ id }, 201);
  });

  r.get('/:id', async (c) => {
    const tx = c.get('tx').client;
    const d = (await tx.query('select id, kind, question, status, opened_by, participants, opened_at, closed_at from discussions where id = $1', [c.req.param('id')])).rows[0];
    if (!d) return c.json({ error: 'Not found' }, 404);
    const turns = await tx.query('select id, speaker, round, body, evidence, disagreements, at from discussion_turns where discussion_id = $1 order by round, at, id', [c.req.param('id')]);
    return c.json({ discussion: d, turns: turns.rows });
  });

  r.post('/:id/close', async (c) => {
    const row = await c.get('tx').client.query("update discussions set status = 'closed', closed_at = now() where id = $1 and status = 'open' returning id", [c.req.param('id')]);
    if (!row.rows[0]) {
      const exists = (await c.get('tx').client.query('select 1 from discussions where id = $1', [c.req.param('id')])).rows[0];
      return exists ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404); // closing a closed one changes nothing
    }
    changed(c, c.req.param('id'));
    return c.json({ ok: true });
  });

  return r;
}

/** The decision log (S6-10). Only a person records a decision, and only here: there is no agent tool for it. */
export function decisionRoutes(deps: { workspaceId: string; bus: Bus }) {
  const r = new Hono<AppEnv>();

  r.get('/', async (c) => {
    const rows = await c.get('tx').client.query("select id, discussion_id, title, decision, owner, to_char(due, 'YYYY-MM-DD') as due, decided_by, decided_at from decisions order by decided_at desc, id desc limit 100");
    return c.json({ decisions: rows.rows });
  });

  r.post('/', async (c) => {
    const parsed = Decide.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'A decision needs a title and the decision itself, and a due date written as 2026-12-31 if there is one.' }, 400);
    const { title, decision, owner, due, discussionId } = parsed.data;
    const tx = c.get('tx').client;
    if (discussionId && !(await tx.query('select 1 from discussions where id = $1', [discussionId])).rows[0]) return c.json({ error: 'That discussion does not exist.' }, 400);
    if (due && Number.isNaN(Date.parse(`${due}T00:00:00Z`))) return c.json({ error: 'That is not a real date.' }, 400);
    const row = await tx.query<{ id: string }>("insert into decisions (workspace_id, discussion_id, title, decision, owner, due, decided_by) values ($1, $2, $3, $4, $5, $6, 'founder') returning id", [deps.workspaceId, discussionId ?? null, title, decision, owner ?? null, due ?? null]);
    return c.json({ id: row.rows[0]!.id }, 201);
  });

  return r;
}
