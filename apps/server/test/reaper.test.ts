import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { cancelAllRuns, executeRun, type LoopDeps } from '../src/harness/loop';
import { reapRuns } from '../src/harness/reaper';
import { RunTokens } from '../src/harness/run-tokens';
import { Bus } from '../src/bus';
import type { Runtime, RunRequest, RunEvent } from '../src/runtimes/types';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

let sys: System;
let agentId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const NOW = new Date('2026-11-13T12:00:00Z');
const reap = (over: Partial<Parameters<typeof reapRuns>[0]> = {}) => reapRuns({ pool: sys.app, workspaceId: ws(), now: () => NOW, ...over });

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'reaper-agent' });
  agentId = (await sql("select id from agents where key = 'reaper-agent'")).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  await sql('delete from run_events');
  await sql('delete from runs');
  await sql("delete from tasks where assignee_id = $1", [agentId]);
});

/** A task checked out by the agent, with runs behind it. `ages` are minutes since each run's last heartbeat, oldest first; the last one is the live run. */
async function stuck(opts: { priorFailures?: number; session?: string | null; heartbeatMinutesAgo?: number } = {}) {
  const task = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, session_id, created_by) values ($1, 'Work', 'in_progress', $2, $2, $3, 'founder') returning id", [ws(), agentId, opts.session === undefined ? 'ses_abc' : opts.session])).rows[0].id as string;
  for (let i = 0; i < (opts.priorFailures ?? 0); i++) {
    await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status, started_at, ended_at, error) values ($1, $2, $3, 'manual', 'claude-cli', 'failed', $4, $4, $5)", [
      ws(),
      agentId,
      task,
      new Date(NOW.getTime() - (10 - i) * 3_600_000),
      `runtime: earlier failure ${i + 1}`,
    ]);
  }
  const run = (
    await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status, started_at, heartbeat_at) values ($1, $2, $3, 'manual', 'claude-cli', 'running', $4, $4) returning id", [
      ws(),
      agentId,
      task,
      new Date(NOW.getTime() - (opts.heartbeatMinutesAgo ?? 10) * 60_000),
    ])
  ).rows[0].id as string;
  return { task, run };
}
const taskRow = async (id: string) => (await sql('select status, locked_by, session_id, blocked_reason from tasks where id = $1', [id])).rows[0];
const runRow = async (id: string) => (await sql('select status, error, ended_at from runs where id = $1', [id])).rows[0];

describe('the reaper (S3-1)', () => {
  it('fails a run that stopped heartbeating, frees its task for another go, and keeps the session to resume', async () => {
    const { task, run } = await stuck();
    const r = await reap();
    expect(r.reaped).toEqual([run]);
    expect(r.requeued).toEqual([{ taskId: task, agentId }]);
    expect(await runRow(run)).toMatchObject({ status: 'failed', error: expect.stringMatching(/stopped responding/) });
    expect((await runRow(run)).ended_at).toBeTruthy();
    expect(await taskRow(task)).toEqual({ status: 'todo', locked_by: null, session_id: 'ses_abc', blocked_reason: null });
    expect((await sql("select 1 from audit_log where action = 'run.failed' and subject = $1", [run])).rowCount).toBe(1);
  });

  it('leaves a run alone while it is heartbeating, and one this very process is still running', async () => {
    const fresh = await stuck({ heartbeatMinutesAgo: 1 });
    expect((await reap()).reaped).toEqual([]);
    expect((await runRow(fresh.run)).status).toBe('running');

    const quiet = await stuck({ heartbeatMinutesAgo: 30 });
    expect((await reap({ isActive: (id) => id === quiet.run })).reaped.includes(quiet.run)).toBe(false); // thinking quietly, but alive
    expect((await runRow(quiet.run)).status).toBe('running');
  });

  it('blocks the task, with the reasons, when it fails a third time in a row', async () => {
    const { task } = await stuck({ priorFailures: 2 });
    const r = await reap();
    expect(r.requeued).toEqual([]);
    const t = await taskRow(task);
    expect(t.status).toBe('blocked');
    expect(t.locked_by).toBeNull();
    expect(t.blocked_reason).toMatch(/failed 3 times in a row/i);
    expect(t.blocked_reason).toMatch(/earlier failure 2/);
  });

  it('counts only the streak since the last good run', async () => {
    const { task } = await stuck({ priorFailures: 2 });
    // A success in between the two old failures and the new one: the streak is just this failure.
    await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status, started_at, ended_at) values ($1, $2, $3, 'manual', 'claude-cli', 'succeeded', $4, $4)", [ws(), agentId, task, new Date(NOW.getTime() - 3_600_000)]);
    const r = await reap();
    expect(r.requeued).toHaveLength(1);
    expect((await taskRow(task)).status).toBe('todo');
  });

  it('does it once: a second pass changes nothing', async () => {
    const { task, run } = await stuck();
    await reap();
    const again = await reap();
    expect(again.reaped).toEqual([]);
    expect(again.requeued).toEqual([]);
    expect((await taskRow(task)).status).toBe('todo');
    expect((await sql("select count(*)::int as n from audit_log where action = 'run.failed' and subject = $1", [run])).rows[0].n).toBe(1);
  });

  it('keeps working when the kill switch is on, and does not touch a task a person has since moved', async () => {
    await sql('update workspace_settings set kill_switch = 1');
    const a = await stuck();
    expect((await reap()).reaped).toEqual([a.run]);
    const b = await stuck();
    await sql("update tasks set status = 'cancelled', locked_by = null where id = $1", [b.task]);
    await reap();
    expect((await taskRow(b.task)).status).toBe('cancelled');
    expect((await runRow(b.run)).status).toBe('failed');
  });

  it('works on a task with no session yet', async () => {
    const { task } = await stuck({ session: null });
    await reap();
    expect(await taskRow(task)).toMatchObject({ status: 'todo', session_id: null });
  });
});

describe('a run that is killed halfway can resume (S3-1)', () => {
  /** A runtime that reports its session at once and then never finishes until cancelled. */
  class HangingRuntime implements Runtime {
    name = 'claude-cli' as const;
    canResume = true;
    requests: RunRequest[] = [];
    private resolvers = new Map<string, () => void>();
    async *start(req: RunRequest): AsyncIterable<RunEvent> {
      this.requests.push(req);
      yield { type: 'session', sessionId: req.sessionId ?? 'ses_first' };
      if (this.requests.length > 1) {
        yield { type: 'done', output: 'finished after resuming' };
        return;
      }
      await new Promise<void>((r) => this.resolvers.set(req.runId, r));
      yield { type: 'error', kind: 'cancelled', message: 'killed' };
    }
    async cancel(runId: string) {
      this.resolvers.get(runId)?.();
    }
    async health() {
      return { ok: true };
    }
  }

  it('saves the session as soon as it is known, so a run killed afterwards can be resumed from it', async () => {
    const rt = new HangingRuntime();
    const deps: LoopDeps = { pool: sys.app, tokens: new RunTokens(), bus: new Bus(), runtimes: { 'claude-cli': rt }, dataDir: sys.dataDir, workspaceSlug: sys.workspace.slug, templatesRoot: sys.templatesRoot, timeoutMs: 30_000 };
    const t = (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, 'Long job', 'todo', $2, 'founder') returning id", [ws(), agentId])).rows[0].id as string;

    const first = executeRun(deps, ws(), agentId, 'manual');
    for (let i = 0; i < 100 && !(await taskRow(t)).session_id; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await taskRow(t)).session_id).toBe('ses_first'); // known while the run is still going
    expect((await sql("select session_id from runs where task_id = $1 and status = 'running'", [t])).rows[0].session_id).toBe('ses_first');
    await cancelAllRuns(); // the process "dies"
    await first;

    // The task goes back, the next run is handed the same session and carries on.
    await sql("update tasks set status = 'todo', locked_by = null where id = $1", [t]);
    const second = await executeRun(deps, ws(), agentId, 'manual');
    expect(second.status).toBe('succeeded');
    expect(rt.requests[1]!.sessionId).toBe('ses_first');
  }, 60_000);
});
