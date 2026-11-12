import { Hono } from 'hono';
import type pg from 'pg';
import { z } from 'zod';
import type { Bus } from '../bus';
import { withWorkspace } from '../db/tenancy';
import type { Dispatcher } from '../workflows/dispatch';

/** The slice 0 API (SPEC 11, API table): tasks, agents, runs. One local workspace, no login yet. */
export function apiRoutes(deps: { pool: pg.Pool; workspaceId: string; dispatcher: Dispatcher; bus: Bus }) {
  const r = new Hono();
  const ws = deps.workspaceId;
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
    withWorkspace(deps.pool, ws, (c) => c.query<T>(sql, params)).then((x) => x.rows);

  r.get('/agents', async (c) =>
    c.json(
      await q(
        `select a.id, a.key, a.name, a.status, a.runtime, a.model_alias, a.autonomy, a.heartbeat_cron, d.key as department,
                (select r.status from runs r where r.agent_id = a.id order by r.started_at desc nulls last limit 1) as last_run_status
         from agents a left join departments d on d.id = a.department_id where a.status <> 'retired' order by d.key, a.key`,
      ),
    ),
  );

  r.post('/agents/:id/run', async (c) => {
    const id = c.req.param('id');
    const found = await q<{ id: string }>("select id from agents where id = $1 and status = 'active'", [id]);
    if (!found.length) return c.json({ error: 'No active agent with that id.' }, 404);
    await deps.dispatcher.request({ workspaceId: ws, agentId: id, trigger: 'manual' });
    return c.json({ requested: true }, 202);
  });

  r.get('/tasks', async (c) =>
    c.json(
      await q(
        `select t.id, t.title, t.body, t.status, t.priority, t.blocked_reason, t.created_at, t.done_at,
                a.id as assignee_id, a.key as assignee_key, a.name as assignee_name,
                (select r.id from runs r where r.task_id = t.id order by r.started_at desc nulls last limit 1) as last_run_id
         from tasks t left join agents a on a.id = t.assignee_id
         where t.status <> 'cancelled' order by t.created_at desc limit 200`,
      ),
    ),
  );

  const NewTask = z.object({
    title: z.string().trim().min(1).max(300),
    body: z.string().max(20_000).optional(),
    assigneeId: z.uuid().optional(),
    priority: z.number().int().min(1).max(5).optional(),
    run: z.boolean().optional(),
  });
  r.post('/tasks', async (c) => {
    const parsed = NewTask.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, 400);
    const t = parsed.data;
    if (t.assigneeId) {
      const a = await q("select id from agents where id = $1 and status <> 'retired'", [t.assigneeId]);
      if (!a.length) return c.json({ error: 'Unknown agent.' }, 400);
    }
    const [row] = await q<{ id: string }>(
      "insert into tasks (workspace_id, title, body, assignee_id, priority, created_by) values ($1, $2, $3, $4, $5, 'founder') returning id",
      [ws, t.title, t.body ?? null, t.assigneeId ?? null, t.priority ?? 3],
    );
    deps.bus.publish({ kind: 'task.changed', workspaceId: ws, taskId: row!.id });
    if (t.assigneeId && t.run !== false) await deps.dispatcher.request({ workspaceId: ws, agentId: t.assigneeId, trigger: 'task_assigned' });
    return c.json({ id: row!.id }, 201);
  });

  const PatchTask = z.object({ status: z.enum(['todo', 'cancelled']).optional(), title: z.string().trim().min(1).max(300).optional() });
  r.patch('/tasks/:id', async (c) => {
    const parsed = PatchTask.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Bad request' }, 400);
    const id = c.req.param('id');
    const rows = await q(
      'update tasks set status = coalesce($2, status), title = coalesce($3, title), blocked_reason = case when $2 = \'todo\' then null else blocked_reason end where id = $1 returning id',
      [id, parsed.data.status ?? null, parsed.data.title ?? null],
    );
    if (!rows.length) return c.json({ error: 'Not found' }, 404);
    deps.bus.publish({ kind: 'task.changed', workspaceId: ws, taskId: id });
    return c.json({ ok: true });
  });

  r.get('/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const [task] = await q('select id, title, body, status, blocked_reason, assignee_id, created_at, done_at from tasks where id = $1', [id]);
    if (!task) return c.json({ error: 'Not found' }, 404);
    const thread = await q('select id, from_id, to_id, body, created_at from messages where task_id = $1 order by created_at', [id]);
    const runs = await q('select id, status, runtime, model, trigger, started_at, ended_at, cost_usd, tokens_in, tokens_out, error from runs where task_id = $1 order by started_at', [id]);
    return c.json({ task, thread, runs });
  });

  r.get('/runs/:id', async (c) => {
    const id = c.req.param('id');
    const [run] = await q('select id, status, runtime, model, trigger, task_id, agent_id, started_at, ended_at, cost_usd, tokens_in, tokens_out, error from runs where id = $1', [id]);
    if (!run) return c.json({ error: 'Not found' }, 404);
    const events = await q('select id, at, type, data from run_events where run_id = $1 order by id', [id]);
    return c.json({ run, events });
  });

  return r;
}
