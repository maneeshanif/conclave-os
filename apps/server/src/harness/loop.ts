import type pg from 'pg';
import type { Bus } from '../bus';
import { withWorkspace } from '../db/tenant';
import { runCheck } from '../checks';
import { checkBudget } from './budget';
import { failureClass } from './failure';
import { activePause, pauseRuntime, parseResetTime, RUNTIME_LABEL } from './pauses';
import { reapRuns } from './reaper';
import { claudeToolLists } from './permissions';
import { withSilenceWatchdog } from './silence';
import { allowedToolsFor, clampForTrust, type Trust } from './trust';
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
  /** A run that produces no event for this long is cancelled and ends with the `silent` error (A2). Default 5 minutes; 0 turns it off. */
  silenceMs?: number;
  /**
   * Retry a transient model error (SPEC 14): wait the first delay, try again, wait the next, and so on, then the agent's
   * fallback model once. Without it a run makes a single attempt.
   */
  retry?: { delaysMs: number[]; sleep?: (ms: number) => Promise<void> };
  /** The clock, for tests. */
  now?: () => Date;
  /** Renders the agent's folder again from its role file. Called before every run. */
  /** Renders the agent's folder again before a run; `over` asks for the folder of its other engine (S4-5). */
  prepare?: (agentKey: string, over?: { runtime: RuntimeName; model: string }) => Promise<void>;
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
  fallback_alias: string | null;
  fallback_runtime: RuntimeName | null;
  trust: Trust;
  output_check: string | null;
  monthly_budget_usd: string;
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
      `select a.id, a.key, a.name, a.status, a.runtime, a.model_alias, a.fallback_alias, a.fallback_runtime, a.trust, a.output_check, a.monthly_budget_usd, a.max_turns, t.key as template_key, d.name as department
       from agents a left join agent_templates t on t.id = a.template_id left join departments d on d.id = a.department_id
       where a.id = $1`,
      [agentId],
    );
    return r.rows[0];
  });
  if (!agent) return { status: 'not_runnable', reason: 'no such agent' };
  if (await killSwitchOn(deps.pool, workspaceId)) return { status: 'not_runnable', reason: 'the kill switch is on' };
  if (agent.status !== 'active') return { status: 'not_runnable', reason: `agent is ${agent.status}` };
  const now = () => (deps.now ?? (() => new Date()))();
  // The other engine this role names (S4-5), used while the first is paused, for retries and for escalation. Only if it exists here.
  const fbRuntime: RuntimeName = agent.fallback_runtime ?? agent.runtime;
  const hasFallback = !!agent.fallback_alias && !!deps.runtimes[fbRuntime];
  // The month's budget is checked before every run: at or over it, nothing starts and no task is taken (S3-4).
  const budget = await checkBudget(deps.pool, workspaceId, agent, (deps.now ?? (() => new Date()))());
  if (budget.over) return { status: 'not_runnable', reason: `${agent.name} is over its budget for the month ($${budget.spent.toFixed(2)} of $${budget.budget.toFixed(2)})` };
  // A runtime that has hit its plan limit starts nothing, and no task is taken, until the reset (S3-3).
  // While it is paused, an agent whose role file names another engine carries on there (a scout moves to the local model);
  // one with no other engine waits in the queue.
  let runtimeName: RuntimeName = agent.runtime;
  let startAlias = agent.model_alias;
  let reroutedFrom: RuntimeName | null = null;
  const paused = await activePause(deps.pool, workspaceId, agent.runtime, now());
  if (paused) {
    const canMove = hasFallback && agent.fallback_runtime && agent.fallback_runtime !== agent.runtime && !(await activePause(deps.pool, workspaceId, agent.fallback_runtime, now()));
    if (!canMove) return { status: 'not_runnable', reason: `${RUNTIME_LABEL[agent.runtime] ?? agent.runtime} is paused until ${paused.until.toISOString()} (a plan limit was reached)` };
    reroutedFrom = agent.runtime;
    runtimeName = agent.fallback_runtime!;
    startAlias = agent.fallback_alias!;
  }
  let runtime = deps.runtimes[runtimeName];
  if (!runtime) return { status: 'not_runnable', reason: `runtime ${runtimeName} is not available` };

  // Wake and check out, in plain code, before any model call.
  const task = await checkoutTask(deps.pool, workspaceId, agentId);
  if (!task) return { status: 'no_task' };

  let runId: string;
  try {
    runId = await withWorkspace(deps.pool, workspaceId, async ({ client: c }) => {
      const r = await c.query<{ id: string }>(
        `insert into runs (workspace_id, agent_id, task_id, trigger, runtime, model, status, started_at, heartbeat_at)
         values ($1, $2, $3, $4, $5, $6, 'running', now(), now()) returning id`,
        [workspaceId, agentId, task.id, trigger, runtimeName, startAlias],
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
  // Retry plan (S3-2): the waits on the agent's own model, then the fallback model once.
  let alias = startAlias;
  // A session belongs to one engine: once this run is on another one it starts fresh and never resumes the old session.
  let noResume = reroutedFrom !== null;
  let attempts = 0;
  let planStep = 0;
  let onFallback = false;
  // Output check (S3-5): the result is checked once the run reports done; a failure gets one repair, then the stronger model.
  let stage: 'main' | 'repair' | 'escalated' = 'main';
  let input: string;
  const plan = deps.retry ? [...deps.retry.delaysMs.map((wait) => ({ alias: startAlias, wait, fallback: false, runtime: runtimeName })), ...(hasFallback && !reroutedFrom ? [{ alias: agent.fallback_alias!, wait: 0, fallback: true, runtime: fbRuntime }] : [])] : [];
  active.set(runId, runtime);
  try {
    await audit(deps.pool, workspaceId, 'run.running', runId, { agent: agent.key, task: task.id, trigger });
    deps.bus.publish({ kind: 'run.state', workspaceId, runId, taskId: task.id, status: 'running' });
    deps.bus.publish({ kind: 'task.changed', workspaceId, taskId: task.id });

    const workspaceDir = agentWorkDir(deps.dataDir, deps.workspaceSlug, agent.key);
    // Fresh harness config for every run, and nothing the agent planted in work/ survives (SPEC 5).
    if (deps.prepare) await deps.prepare(agent.key, reroutedFrom ? { runtime: runtimeName, model: startAlias } : undefined);
    await cleanWorkFolder(workspaceDir);
    const note = (data: unknown) => withWorkspace(deps.pool, workspaceId, ({ client: c }) => c.query('insert into run_events (workspace_id, run_id, type, data) values ($1, $2, $3, $4)', [workspaceId, runId, 'reroute', JSON.stringify(data)])).catch(() => undefined);
    if (reroutedFrom) await note({ from: reroutedFrom, to: runtimeName, model: startAlias, reason: 'paused' });
    // Moves this run to another engine: its folder is rendered for that engine, the run row says where it is, and no session carries over.
    const switchTo = async (to: RuntimeName, toAlias: string, reason: string) => {
      if (to === runtimeName) return;
      const from = runtimeName;
      runtimeName = to;
      runtime = deps.runtimes[to]!;
      active.set(runId, runtime);
      noResume = true;
      sessionId = undefined;
      if (deps.prepare) await deps.prepare(agent.key, { runtime: to, model: toAlias });
      await cleanWorkFolder(workspaceDir);
      await withWorkspace(deps.pool, workspaceId, ({ client: c }) => c.query('update runs set runtime = $2, model = $3 where id = $1', [runId, to, toAlias]));
      await note({ from, to, model: toAlias, reason });
    };

    const { instructions, taskInput } = buildContext(agent, task);
    input = taskInput;
    let tools: { allow: string[]; deny: string[] } = { allow: [], deny: [] };
    let allowedOs: string[] | undefined;
    if (agent.template_key) {
      const tpl = await loadTemplate(deps.templatesRoot, agent.template_key);
      tools = claudeToolLists(clampForTrust(tpl.permissions, agent.trust));
      allowedOs = allowedToolsFor(agent.trust, tpl.plugins.map((p) => p.tools));
    } else if (agent.trust === 'low') allowedOs = allowedToolsFor('low', []); // no template to read: only the base tools, never more
    // A low-trust run's token carries its trust and the tools it may call; the os server enforces both (A1).
    const token = deps.tokens.issue({ workspaceId, agentId, runId, taskId: task.id, ...(agent.trust === 'low' ? { trust: 'low' as const } : {}), ...(allowedOs ? { allowedTools: allowedOs } : {}) });

    for (;;) {
    attempts++;
    final = undefined;
    const live = runtime;
    for await (const e of withSilenceWatchdog<RunEvent>(
      live.start({
      runId,
      workspaceId,
      agentId,
      agentKey: agent.key,
      taskId: task.id,
      instructions,
      taskInput: input,
      workspaceDir,
      modelAlias: alias,
      maxTurns: agent.max_turns,
      runToken: token,
      timeoutMs: deps.timeoutMs ?? 900_000,
      allowedTools: tools.allow,
      deniedTools: tools.deny,
      ...((noResume ? sessionId : (sessionId ?? task.session_id)) ? { sessionId: (noResume ? sessionId : (sessionId ?? task.session_id))! } : {}),
      }),
      deps.silenceMs ?? 300_000,
      () => live.cancel(runId),
      (ms) => ({ type: 'error', kind: 'silent', message: `The run produced no output for ${Math.round(ms / 1000)} seconds, so it was stopped. It was most likely stuck.` }),
    )) {
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
    // A transient error (rate limit, overload, network) is retried with growing waits, then once on the fallback model.
    // Anything else, a plan limit included, ends the run here. The kill switch is looked at before and after each wait.
    const next = plan[planStep];
    if (final?.type === 'error' && next && failureClass(final) === 'transient' && !(await killSwitchOn(deps.pool, workspaceId))) {
      planStep++;
      const note = { attempt: planStep, waitMs: next.wait, model: next.alias, fallback: next.fallback, after: final.message.slice(0, 300) };
      await withWorkspace(deps.pool, workspaceId, ({ client: c }) => c.query('insert into run_events (workspace_id, run_id, type, data) values ($1, $2, $3, $4)', [workspaceId, runId, 'retry', JSON.stringify(note)])).catch(() => undefined);
      await (deps.retry?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(next.wait);
      if (await killSwitchOn(deps.pool, workspaceId)) break;
      alias = next.alias;
      onFallback = next.fallback;
      if (next.fallback) await switchTo(next.runtime, next.alias, 'retry');
      continue;
    }
    if (final?.type === 'done' && agent.output_check) {
      const output = final.output;
      const check = agent.output_check;
      const verdict = await withWorkspace(deps.pool, workspaceId, ({ client: c }) => runCheck(c, check, { output, runId }));
      if (!verdict.ok) {
        const move: "repair" | "escalate" | null = verdict.fatal ? null : stage === 'main' ? 'repair' : stage === 'repair' && hasFallback ? 'escalate' : null;
        if (move) {
          await withWorkspace(deps.pool, workspaceId, ({ client: c }) =>
            c.query('insert into run_events (workspace_id, run_id, type, data) values ($1, $2, $3, $4)', [workspaceId, runId, 'repair', JSON.stringify({ stage: move, check, reasons: verdict.reasons })]),
          ).catch(() => undefined);
          input = `Your result failed the ${check} check:\n${verdict.reasons.map((r) => `- ${r}`).join('\n')}\nFix exactly these problems and finish the task again with a corrected result. Do not start over and do not do anything else.`;
          if (move === 'escalate') {
            alias = agent.fallback_alias!;
            onFallback = true;
            await switchTo(fbRuntime, alias, 'escalate');
          }
          stage = move === 'repair' ? 'repair' : 'escalated';
          continue;
        }
        const tried = stage === 'main' ? '' : stage === 'repair' ? ' after one repair attempt' : ' after one repair attempt and a try on the stronger model';
        final = { type: 'error', kind: 'output_check', message: `The result failed the ${check} check${tried}: ${verdict.reasons.join(' ')}` };
      }
    }
    break;
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

  const planLimit = final?.type === 'error' && failureClass(final) === 'plan_limit';

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
      } else if (planLimit) {
        // Not the task's fault and not worth a person's time: it waits in the queue and carries on after the reset.
        await c.query("update tasks set status = 'todo', locked_by = null where id = $1", [task.id]);
      } else {
        await c.query("update tasks set status = 'blocked', blocked_reason = $2, locked_by = null where id = $1", [
          task.id,
          `Run ${status}: ${error?.kind}: ${error?.message ?? ''}${attempts > 1 ? ` (after ${attempts} attempts${onFallback ? ', the last on the fallback model' : ''})` : ''}`.slice(0, 2000),
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
  if (planLimit && error) {
    await withWorkspace(deps.pool, workspaceId, ({ client: c }) => pauseRuntime(c, workspaceId, runtimeName, parseResetTime(error.message, (deps.now ?? (() => new Date()))()), error.message)).catch((err) => console.error('could not pause the runtime:', (err as Error).message));
  }
  deps.bus.publish({ kind: 'run.state', workspaceId, runId, taskId: task.id, status, ...(error ? { error: `${error.kind}: ${error.message}` } : {}) });
  deps.bus.publish({ kind: 'task.changed', workspaceId, taskId: task.id });
  return ok ? { status: 'succeeded', runId, taskId: task.id } : { status: 'failed', runId, taskId: task.id, ...(error ? { error } : {}) };
}
