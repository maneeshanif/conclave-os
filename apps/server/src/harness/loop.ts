import type pg from 'pg';
import type { Bus } from '../bus';
import { withWorkspace } from '../db/tenant';
import { reapRuns } from './reaper';
import { claudeToolLists } from './permissions';
import { cleanWorkFolder, loadTemplate } from './render';
import type { RunTokens } from './run-tokens';
import type { RuntimeName } from '../runtimes/names';
import type { ErrorKind, RunEvent, Runtime } from '../runtimes/types';
import { agentWorkDir } from '../paths';

export interface LoopDeps {
  pool: pg.Pool;
  tokens: RunTokens;
  bus: Bus;
  runtimes: Partial<Record<RuntimeName, Runtime>>;
  dataDir: string;
  workspaceSlug: string;
  templatesRoot: string;
  /** Run timeout; default 15 minutes. */
  timeoutMs?: number;
  /** Renders the agent's folder again from its role file. Called before every run. */
  prepare?: (agentKey: string) => Promise<void>;
}

export async function killSwitchOn(pool: pg.Pool, workspaceId: string): Promise<boolean> {
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ kill_switch: number }>('select kill_switch from workspace_settings'));
  return (r.rows[0]?.kill_switch ?? 0) === 1;
}

export type RunOutcome =
  | { status: 'no_task' }
  | { status: 'not_runnable'; reason: string }
  | { status: 'succeeded' | 'failed'; runId: string; taskId: string; error?: { kind: ErrorKind; message: string } };

interface AgentRow {
  id: string;
  key: string;
  name: string;
  status: string;
  runtime: RuntimeName;
  model_alias: string;
  max_turns: number;
  template_key: string | null;
  department: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  body: string | null;
  session_id: string | null;
  goal_title: string | null;
}

/**
 * Checks out the agent's next task with one atomic update (SPEC 11): two runs at the same moment
 * can never take the same task. Returns null when there is no work, before any model call.
 */
export async function checkoutTask(pool: pg.Pool, workspaceId: string, agentId: string): Promise<TaskRow | null> {
  return withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const r = await c.query<TaskRow>(
      `update tasks set status = 'in_progress', locked_by = $1, locked_at = now()
       where id = (
         select id from tasks
         where assignee_id = $1 and status = 'todo'
         order by priority, created_at
         for update skip locked limit 1
       )
       returning id, title, body, session_id, (select g.title from goals g where g.id = tasks.goal_id) as goal_title`,
      [agentId],
    );
    return r.rows[0] ?? null;
  });
}

function buildContext(agent: AgentRow, task: TaskRow): { instructions: string; taskInput: string } {
  const instructions = [
    '# This run',
    `You are ${agent.name}${agent.department ? `, in ${agent.department}` : ''}.`,
    `Your task: ${task.title}`,
    task.goal_title ? `It serves the goal: ${task.goal_title}` : '',
    'Read the full task with get_task. When the work is done, call complete_task with your answer.',
    'If you cannot continue, call block_task with the reason, or ask_founder with one specific question.',
  ]
    .filter(Boolean)
    .join('\n');
  const taskInput = `${task.title}\n\n${task.body ?? ''}`.trim();
  return { instructions, taskInput };
}

async function audit(pool: pg.Pool, ws: string, action: string, subject: string, data: Record<string, unknown>) {
  await withWorkspace(pool, ws, ({ client: c }) =>
    c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'system', $2, $3, $4)", [ws, action, subject, JSON.stringify(data)]),
  );
}

/** Runs in progress in this process, so shutdown and the kill switch can stop them. */
const active = new Map<string, Runtime>();

/** Whether this process is still running that run, so the reaper does not mistake a quiet one for a dead one. */
export const isRunActive = (runId: string) => active.has(runId);

/** Cancels every run in progress in this process. */
export async function cancelAllRuns(): Promise<number> {
  const runs = [...active.entries()];
  await Promise.all(runs.map(([id, rt]) => rt.cancel(id).catch(() => undefined)));
  return runs.length;
}

/**
 * On server start: a run still marked running or queued belongs to a process that is gone. The reaper (S3-1) fails it and
 * puts its task back with the session kept, so the next run resumes, or blocks the task on its third failure in a row. A
 * task stuck in progress with no run at all is blocked, because nothing says how far it got.
 */
export async function reapStaleRuns(pool: pg.Pool, workspaceId: string): Promise<number> {
  const r = await reapRuns({ pool, workspaceId, staleAfterMs: 0 });
  await withWorkspace(pool, workspaceId, async ({ client: c }) => {
    await c.query(
      "update tasks set status = 'blocked', locked_by = null, blocked_reason = 'The server stopped before this task''s run began. Move it back to todo to run it again.' where status = 'in_progress' and not exists (select 1 from runs r where r.task_id = tasks.id and r.status = 'running')",
    );
  });
  return r.reaped.length;
}

/**
 * One run, end to end (SPEC 5, the eight steps; this slice covers wake, checkout, context, act and
 * report). Once a run row exists, a terminal state is always written, whatever fails.
 */
export async function executeRun(deps: LoopDeps, workspaceId: string, agentId: string, trigger: string): Promise<RunOutcome> {
  const agent = await withWorkspace(deps.pool, workspaceId, async ({ client: c }) => {
    const r = await c.query<AgentRow>(
      `select a.id, a.key, a.name, a.status, a.runtime, a.model_alias, a.max_turns, t.key as template_key, d.name as department
       from agents a left join agent_templates t on t.id = a.template_id left join departments d on d.id = a.department_id
       where a.id = $1`,
      [agentId],
    );
    return r.rows[0];
  });
  if (!agent) return { status: 'not_runnable', reason: 'no such agent' };
  if (await killSwitchOn(deps.pool, workspaceId)) return { status: 'not_runnable', reason: 'the kill switch is on' };
  if (agent.status !== 'active') return { status: 'not_runnable', reason: `agent is ${agent.status}` };
  const runtime = deps.runtimes[agent.runtime];
  if (!runtime) return { status: 'not_runnable', reason: `runtime ${agent.runtime} is not available` };

  // Wake and check out, in plain code, before any model call.
  const task = await checkoutTask(deps.pool, workspaceId, agentId);
  if (!task) return { status: 'no_task' };

  let runId: string;
  try {
    runId = await withWorkspace(deps.pool, workspaceId, async ({ client: c }) => {
      const r = await c.query<{ id: string }>(
        `insert into runs (workspace_id, agent_id, task_id, trigger, runtime, model, status, started_at, heartbeat_at)
         values ($1, $2, $3, $4, $5, $6, 'running', now(), now()) returning id`,
        [workspaceId, agentId, task.id, trigger, agent.runtime, agent.model_alias],
      );
      return r.rows[0]!.id;
    });
  } catch (err) {
    // No run row: put the task back so it is not lost.
    await withWorkspace(deps.pool, workspaceId, ({ client: c }) =>
      c.query("update tasks set status = 'todo', locked_by = null where id = $1 and status = 'in_progress'", [task.id]),
    ).catch(() => undefined);
    throw err;
  }

  let seq = 0;
  let final: RunEvent | undefined;
  let usd = 0;
  let tin = 0;
  let tout = 0;
  let sessionId: string | undefined;
  active.set(runId, runtime);
  try {
    await audit(deps.pool, workspaceId, 'run.running', runId, { agent: agent.key, task: task.id, trigger });
    deps.bus.publish({ kind: 'run.state', workspaceId, runId, taskId: task.id, status: 'running' });
    deps.bus.publish({ kind: 'task.changed', workspaceId, taskId: task.id });

    const workspaceDir = agentWorkDir(deps.dataDir, deps.workspaceSlug, agent.key);
    // Fresh harness config for every run, and nothing the agent planted in work/ survives (SPEC 5).
    if (deps.prepare) await deps.prepare(agent.key);
    await cleanWorkFolder(workspaceDir);

    const token = deps.tokens.issue({ workspaceId, agentId, runId, taskId: task.id });
    const { instructions, taskInput } = buildContext(agent, task);
    let tools: { allow: string[]; deny: string[] } = { allow: [], deny: [] };
    if (agent.template_key) tools = claudeToolLists((await loadTemplate(deps.templatesRoot, agent.template_key)).permissions);

    for await (const e of runtime.start({
      runId,
      workspaceId,
      agentId,
      agentKey: agent.key,
      taskId: task.id,
      instructions,
      taskInput,
      workspaceDir,
      modelAlias: agent.model_alias,
      maxTurns: agent.max_turns,
      runToken: token,
      timeoutMs: deps.timeoutMs ?? 900_000,
      allowedTools: tools.allow,
      deniedTools: tools.deny,
      ...(task.session_id ? { sessionId: task.session_id } : {}),
    })) {
      seq++;
      if (e.type === 'cost') {
        usd += e.usd;
        tin += e.tokensIn;
        tout += e.tokensOut;
      }
      if (e.type === 'session') {
        sessionId = e.sessionId;
        await withWorkspace(deps.pool, workspaceId, ({ client: c }) =>
          Promise.all([c.query('update tasks set session_id = $2 where id = $1', [task.id, e.sessionId]), c.query('update runs set session_id = $2 where id = $1', [runId, e.sessionId])]),
        ).catch((err) => console.error(`run ${runId}: could not save the session:`, (err as Error).message));
      }
      if (e.type === 'done' || e.type === 'error') final = e;
      try {
        await withWorkspace(deps.pool, workspaceId, ({ client: c }) =>
          Promise.all([
            c.query('insert into run_events (workspace_id, run_id, type, data) values ($1, $2, $3, $4)', [workspaceId, runId, e.type, JSON.stringify(e)]),
            c.query('update runs set heartbeat_at = now() where id = $1', [runId]),
          ]),
        );
      } catch (err) {
        console.error(`run ${runId}: could not store an event:`, (err as Error).message);
      }
      deps.bus.publish({ kind: 'run.event', workspaceId, runId, taskId: task.id, seq, event: e });
    }
  } catch (err) {
    final = { type: 'error', kind: 'runtime', message: (err as Error).message };
    await withWorkspace(deps.pool, workspaceId, ({ client: c }) =>
      c.query('insert into run_events (workspace_id, run_id, type, data) values ($1, $2, $3, $4)', [workspaceId, runId, 'error', JSON.stringify(final)]),
    ).catch(() => undefined);
  } finally {
    active.delete(runId);
    deps.tokens.revokeRun(runId);
  }

  const ok = final?.type === 'done';
  const error = final?.type === 'error' ? { kind: final.kind, message: final.message } : ok ? undefined : { kind: 'runtime' as ErrorKind, message: 'the run ended without a result' };
  const status = ok ? 'succeeded' : error?.kind === 'cancelled' ? 'cancelled' : error?.kind === 'timeout' ? 'timed_out' : 'failed';

  // Report: if the agent did not close its task itself, the run's result closes it.
  await withWorkspace(deps.pool, workspaceId, async ({ client: c }) => {
    await c.query(
      'update runs set status = $2, ended_at = now(), cost_usd = $3, tokens_in = $4, tokens_out = $5, session_id = $6, error = $7 where id = $1',
      [runId, status, usd, tin, tout, sessionId ?? null, error ? `${error.kind}: ${error.message}` : null],
    );
    if (sessionId) await c.query('update tasks set session_id = $2 where id = $1', [task.id, sessionId]);
    const cur = await c.query<{ status: string }>('select status from tasks where id = $1', [task.id]);
    if (cur.rows[0]?.status === 'in_progress') {
      if (ok) {
        const out = (final as Extract<RunEvent, { type: 'done' }>).output.trim();
        if (out) await c.query('insert into messages (workspace_id, task_id, from_id, body) values ($1, $2, $3, $4)', [workspaceId, task.id, `agent:${agent.key}`, out]);
        await c.query("update tasks set status = 'done', done_at = now(), locked_by = null where id = $1", [task.id]);
      } else {
        await c.query("update tasks set status = 'blocked', blocked_reason = $2, locked_by = null where id = $1", [
          task.id,
          `Run ${status}: ${error?.kind}: ${error?.message ?? ''}`.slice(0, 2000),
        ]);
      }
    }
    await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'system', $2, $3, $4)", [
      workspaceId,
      `run.${status}`,
      runId,
      JSON.stringify({ agent: agent.key, task: task.id, ...(error ? { error } : {}) }),
    ]);
  });
  deps.bus.publish({ kind: 'run.state', workspaceId, runId, taskId: task.id, status, ...(error ? { error: `${error.kind}: ${error.message}` } : {}) });
  deps.bus.publish({ kind: 'task.changed', workspaceId, taskId: task.id });
  return ok ? { status: 'succeeded', runId, taskId: task.id } : { status: 'failed', runId, taskId: task.id, ...(error ? { error } : {}) };
}
