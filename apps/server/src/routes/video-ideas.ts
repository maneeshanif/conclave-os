import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import { classifyIdea, IDEA_KINDS, IDEA_STAGES, ideaView, type IdeaRow } from '../video/ideas';

const ACTOR = 'founder';
const COLUMNS = 'id, idea, kind, url, source, stage, hook_id, created_at';

const NewIdea = z.object({ idea: z.string().trim().min(1).max(5000), kind: z.enum(IDEA_KINDS).optional(), hookId: z.uuid().optional() }).strict();
const List = z.object({ stage: z.enum([...IDEA_STAGES, 'all']).default('idea') });

/** The Video Ideas inbox (S5-7): drop an idea in, shelve it, or turn it into a brief. */
export function videoIdeaRoutes(deps: { workspaceId: string; bus: Bus }) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;

  r.get('/', async (c) => {
    const parsed = List.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'stage must be one of: ' + [...IDEA_STAGES, 'all'].join(', ') }, 400);
    const rows = await c.get('tx').client.query<IdeaRow>(`select ${COLUMNS} from video_ideas where ($1 = 'all' or stage = $1) order by created_at desc, id limit 300`, [parsed.data.stage]);
    return c.json(rows.rows.map(ideaView));
  });

  r.get('/:id', async (c) => {
    const row = (await c.get('tx').client.query<IdeaRow>(`select ${COLUMNS} from video_ideas where id = $1`, [c.req.param('id')])).rows[0];
    return row ? c.json(ideaView(row)) : c.json({ error: 'Not found' }, 404);
  });

  r.post('/', async (c) => {
    const parsed = NewIdea.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    const tx = c.get('tx').client;
    const { idea, kind: hint, hookId } = parsed.data;
    if (hookId && !(await tx.query('select 1 from hooks where id = $1', [hookId])).rows[0]) return c.json({ error: 'No such hook.' }, 404);
    const { kind, url } = classifyIdea(idea, hint);
    const row = (
      await tx.query<IdeaRow>(`insert into video_ideas (workspace_id, source, idea, kind, url, hook_id, created_by) values ($1, 'founder', $2, $3, $4, $5, $6) returning ${COLUMNS}`, [ws, idea.trim(), kind, url, hookId ?? null, ACTOR])
    ).rows[0]!;
    await tx.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'video_idea.added', $3, $4)", [ws, ACTOR, row.id, JSON.stringify({ kind })]);
    return c.json(ideaView(row), 201);
  });

  /** Moves an idea from one stage to another, only from the stage it must be in. */
  const move = (action: string, from: string, to: string, why: string) =>
    r.post(`/:id/${action}`, async (c) => {
      const tx = c.get('tx').client;
      const id = c.req.param('id');
      const cur = (await tx.query<{ stage: string }>('select stage from video_ideas where id = $1 for update', [id])).rows[0];
      if (!cur) return c.json({ error: 'Not found' }, 404);
      if (cur.stage !== from) return c.json({ error: `${why} (this idea is ${cur.stage}).` }, 409);
      const row = (await tx.query<IdeaRow>(`update video_ideas set stage = $2, updated_at = now() where id = $1 returning ${COLUMNS}`, [id, to])).rows[0]!;
      await tx.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, $3, $4, '{}')", [ws, ACTOR, `video_idea.${action === 'brief' ? 'briefed' : action === 'unshelve' ? 'unshelved' : 'shelved'}`, id]);
      return c.json(ideaView(row));
    });
  move('shelve', 'idea', 'shelved', 'Only an idea that is still an idea can be shelved');
  move('unshelve', 'shelved', 'idea', 'Only a shelved idea can be brought back');
  move('brief', 'idea', 'brief', 'Only an idea can be turned into a brief; bring a shelved one back first');

  return r;
}
