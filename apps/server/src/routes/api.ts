import { Hono, type Context } from 'hono';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import type { Dispatcher } from '../workflows/dispatch';
import { approvalRoutes, type ApprovalDecision } from './approvals';
import { goalRoutes } from './goals';
import { leadRoutes } from './leads';
import { actionItemRoutes } from './action-items';
import { briefRoutes } from './brief';
import { browserRoutes } from './browser';
import { campaignRoutes } from './campaigns';
import { crmRoutes } from './crm';
import { reportRoutes } from './reports';
import type { ReaperStatus } from '../health';
import { healthRoutes } from './health';
import { pauseRoutes } from './pauses';
import { settingsRoutes } from './settings';
import { signalRoutes } from './signals';
import { videoIdeaRoutes } from './video-ideas';
import { threadRoutes } from './threads';
import { suppressionRoutes } from './suppression';

/**
 * The slice 0 API (SPEC 11, API table): agents, tasks, runs. One local workspace, no login yet.
 * Every handler runs in the request transaction from app.ts. Starting a run waits until it commits.
 */
export function apiRoutes(deps: { workspaceId: string; dispatcher: Dispatcher; bus: Bus; onApprovalDecided?: (d: ApprovalDecision) => Promise<void> | void;
  onKillSwitch?: (on: boolean) => Promise<void> | void;
  onReleaseHeld?: () => Promise<number> | number;
  /** Copies the company folder into the database again (S3-4): a raised budget, a new goal or funnel, without a restart. */
  onCompanyReload?: () => Promise<Record<string, number>>;
  /** What the last reaper pass did, for the Health screen (S3-7). */
  reaperStatus?: ReaperStatus;
}) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;
  const q = async <T extends QueryResultRow>(c: Context<AppEnv>, sql: string, params: unknown[] = []) =>
    (await c.get('tx').client.query<T>(sql, params)).rows;
  const afterCommit = (c: Context<AppEnv>, fn: () => Promise<void>) => c.get('after').push(fn);
  // A malformed id is a 404, not a database error.
  // Settings is a single record with actions (/settings/release-held), not a collection of ids.
  const idGuard = async (c: Context<AppEnv>, next: () => Promise<void>) =>
    c.req.param('kind') === 'settings' || c.req.param('kind') === 'brief' || c.req.param('kind') === 'company' || c.req.param('kind') === 'runtime-pauses' || c.req.param('kind') === 'health' || c.req.param('kind') === 'browser' || (c.req.param('kind') === 'leads' && c.req.param('id') === 'import') || z.uuid().safeParse(c.req.param('id')).success ? next() : c.json({ error: 'Not found' }, 404);
  r.use('/:kind/:id/*', idGuard);
  r.use('/:kind/:id', idGuard);

  r.route('/approvals', approvalRoutes({ workspaceId: ws, bus: deps.bus, onDecided: deps.onApprovalDecided }));
  r.route('/leads', leadRoutes({ workspaceId: ws, bus: deps.bus }));
  r.route('/', crmRoutes({ workspaceId: ws, bus: deps.bus }));
  r.route('/', campaignRoutes({ workspaceId: ws, bus: deps.bus }));
  r.route('/', reportRoutes());
  r.route('/', goalRoutes());

  // Reads the company folder again. A mistake in a file is reported with the file and the reason, and nothing is changed.
  r.post('/company/reload', async (c) => {
    if (!deps.onCompanyReload) return c.json({ error: 'Reloading is not available here.' }, 404);
    try {
      return c.json(await deps.onCompanyReload());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
  r.route('/', healthRoutes({ ...(deps.reaperStatus ? { reaper: deps.reaperStatus } : {}) }));
  r.route('/browser', browserRoutes());
  r.route('/', pauseRoutes({ workspaceId: ws, bus: deps.bus }));
  r.route('/', briefRoutes({ workspaceId: ws, bus: deps.bus }));
  r.route('/', threadRoutes({ workspaceId: ws, bus: deps.bus }));
  r.route('/action-items', actionItemRoutes({ workspaceId: ws, bus: deps.bus }));
  r.route('/suppression', suppressionRoutes({ workspaceId: ws }));
  r.route('/signals', signalRoutes({ workspaceId: ws, bus: deps.bus }));
  r.route('/video-ideas', videoIdeaRoutes({ workspaceId: ws, bus: deps.bus }));
  r.route('/settings', settingsRoutes({ workspaceId: ws, bus: deps.bus, onKillSwitch: deps.onKillSwitch, onReleaseHeld: deps.onReleaseHeld }));

  r.get('/agents', async (c) =>
    c.json(
      await q(
        c,
        `select a.id, a.key, a.name, a.status, a.runtime, a.model_alias, a.autonomy, a.heartbeat_cron, d.key as department,
                (select r.status from runs r where r.agent_id = a.id order by r.started_at desc nulls last limit 1) as last_run_status
         from agents a left join departments d on d.id = a.department_id where a.status <> 'retired' order by d.key, a.key`,
      ),
    ),
  );

  r.post('/agents/:id/run', async (c) => {
    const id = c.req.param('id');
    const found = await q(c, "select id from agents where id = $1 and status = 'active'", [id]);
    if (!found.length) return c.json({ error: 'No active agent with that id.' }, 404);
    afterCommit(c, () => deps.dispatcher.request({ workspaceId: ws, agentId: id, trigger: 'manual' }));
    return c.json({ requested: true }, 202);
  });

  r.get('/tasks', async (c) =>
    c.json(
      await q(
        c,
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
      const a = await q(c, "select id from agents where id = $1 and status <> 'retired'", [t.assigneeId]);
      if (!a.length) return c.json({ error: 'Unknown agent.' }, 400);
    }
    const [row] = await q<{ id: string }>(
      c,
      "insert into tasks (workspace_id, title, body, assignee_id, priority, created_by) values ($1, $2, $3, $4, $5, 'founder') returning id",
      [ws, t.title, t.body ?? null, t.assigneeId ?? null, t.priority ?? 3],
    );
    const id = row!.id;
    afterCommit(c, async () => {
      deps.bus.publish({ kind: 'task.changed', workspaceId: ws, taskId: id });
      if (t.assigneeId && t.run !== false) await deps.dispatcher.request({ workspaceId: ws, agentId: t.assigneeId, trigger: 'task_assigned' });
    });
    return c.json({ id }, 201);
  });

  const PatchTask = z.object({ status: z.enum(['todo', 'cancelled']).optional(), title: z.string().trim().min(1).max(300).optional() });
  r.patch('/tasks/:id', async (c) => {
    const parsed = PatchTask.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Bad request' }, 400);
    const id = c.req.param('id');
    const rows = await q(
      c,
      // Changing the status takes the task away from whichever agent held it, so a run still going for it can no
      // longer comment on it or finish it (S0-14). Renaming alone leaves the holder in place.
      `update tasks set status = coalesce($2, status), title = coalesce($3, title),
         blocked_reason = case when $2 = 'todo' then null else blocked_reason end,
         locked_by = case when $2::text is not null then null else locked_by end,
         locked_at = case when $2::text is not null then null else locked_at end
       where id = $1 returning id`,
      [id, parsed.data.status ?? null, parsed.data.title ?? null],
    );
    if (!rows.length) return c.json({ error: 'Not found' }, 404);
    afterCommit(c, async () => deps.bus.publish({ kind: 'task.changed', workspaceId: ws, taskId: id }));
    return c.json({ ok: true });
  });

  r.get('/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const [task] = await q(c, 'select id, title, body, status, blocked_reason, assignee_id, created_at, done_at from tasks where id = $1', [id]);
    if (!task) return c.json({ error: 'Not found' }, 404);
    const thread = await q(c, 'select id, from_id, to_id, body, created_at from messages where task_id = $1 order by created_at', [id]);
    const runs = await q(c, 'select id, status, runtime, model, trigger, started_at, ended_at, cost_usd, tokens_in, tokens_out, error from runs where task_id = $1 order by started_at', [id]);
    return c.json({ task, thread, runs });
  });

  r.get('/runs/:id', async (c) => {
    const id = c.req.param('id');
    const [run] = await q(c, 'select id, status, runtime, model, trigger, task_id, agent_id, started_at, ended_at, cost_usd, tokens_in, tokens_out, error from runs where id = $1', [id]);
    if (!run) return c.json({ error: 'Not found' }, 404);
    const events = await q(c, 'select id, at, type, data from run_events where run_id = $1 order by id', [id]);
    return c.json({ run, events });
  });

  return r;
}
