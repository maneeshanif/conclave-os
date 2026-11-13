import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { baselineOf, compare, loadSet, referenceDrafter, runEval, type EvalLead } from '../src/eval';
import { cancelAllRuns, executeRun, type LoopDeps } from '../src/harness/loop';
import { liftExpiredPauses } from '../src/harness/pauses';
import { reapRuns } from '../src/harness/reaper';
import { RunTokens } from '../src/harness/run-tokens';
import type { Runtime, RunEvent, RunRequest } from '../src/runtimes/types';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/**
 * Slice 3 end to end (S3-11, SPEC 18 row 3). Done when: (1) a run killed halfway resumes from its session; (2) a plan limit
 * pauses the agents on that runtime and lifts at the reset; (3) a skill change that hurts the sample leads is blocked by the
 * gate. The real run loop, reaper, pauses and eval gate; only the model is a scripted stand-in.
 */
let sys: System;
const ids: Record<string, string> = {};
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const addTask = async (agent: string, title: string) => (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, $2, 'todo', $3, 'founder') returning id", [ws(), title, agent])).rows[0].id as string;
const taskRow = async (id: string) => (await sql('select status, session_id from tasks where id = $1', [id])).rows[0];
const NOW = new Date('2026-11-13T12:00:00Z');
const RESET = new Date('2026-11-13T17:00:00Z');

class Scripted implements Runtime {
  canResume = true;
  starts = 0;
  constructor(
    public name: 'claude-cli' | 'opencode',
    private script: (req: RunRequest, n: number) => AsyncIterable<RunEvent>,
  ) {}
  start(req: RunRequest) {
    return this.script(req, ++this.starts);
  }
  async cancel() {}
  async health() {
    return { ok: true };
  }
}
const deps = (runtimes: LoopDeps['runtimes'], now = NOW): LoopDeps & { now: () => Date } => ({ pool: sys.app, tokens: new RunTokens(), bus: { publish: () => undefined } as never, runtimes, dataDir: sys.dataDir, workspaceSlug: sys.workspace.slug, templatesRoot: sys.templatesRoot, timeoutMs: 30_000, now: () => now });
async function* finish(output = 'done'): AsyncIterable<RunEvent> {
  yield { type: 'session', sessionId: 'ses_ok' };
  yield { type: 'done', output };
}

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'e2e-long' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'e2e-a' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'e2e-b' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'e2e-oc', runtime: 'opencode', model: 'any-model' });
  for (const k of ['e2e-long', 'e2e-a', 'e2e-b', 'e2e-oc']) ids[k] = (await sql('select id from agents where key = $1', [k])).rows[0].id;
}, 240_000);
afterAll(async () => sys?.close());

describe('slice 3 end to end', () => {
  it('(1) a run killed halfway resumes from its session', async () => {
    let release: () => void = () => undefined;
    const runtime = new Scripted('claude-cli', async function* (req, n) {
      yield { type: 'session', sessionId: req.sessionId ?? 'ses_long' };
      if (n === 1) {
        await new Promise<void>((r) => (release = r)); // the process is still "running" when it is lost
        yield { type: 'error', kind: 'cancelled', message: 'lost' };
        return;
      }
      yield { type: 'done', output: 'finished after resuming' };
    });
    const d = deps({ 'claude-cli': runtime });
    const t = await addTask(ids['e2e-long']!, 'A long job');
    const first = executeRun(d, ws(), ids['e2e-long']!, 'manual');
    for (let i = 0; i < 100 && !(await taskRow(t)).session_id; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await taskRow(t)).session_id).toBe('ses_long'); // saved the moment it was known

    // Nothing is running it any more and its heartbeat has stopped: the reaper fails the run and puts the task back.
    await new Promise((r) => setTimeout(r, 150)); // the last event's heartbeat must be in the past, or a busy machine can race it
    const reaped = await reapRuns({ pool: sys.app, workspaceId: ws(), isActive: () => false, staleAfterMs: 0 });
    expect(reaped.requeued.map((r) => r.taskId)).toEqual([t]);
    expect(await taskRow(t)).toMatchObject({ status: 'todo', session_id: 'ses_long' });

    const second = await executeRun(d, ws(), ids['e2e-long']!, 'manual');
    expect(second.status).toBe('succeeded');
    expect(runtime.starts).toBe(2);
    expect((await taskRow(t)).status).toBe('done');
    release();
    await cancelAllRuns();
    await first;
  }, 60_000);

  it('(2) a plan limit pauses the agents on that runtime, not the others, and lifts at the reset', async () => {
    const limited = new Scripted('claude-cli', async function* () {
      yield { type: 'session', sessionId: 'ses_lim' };
      yield { type: 'error', kind: 'limit', message: `Claude AI usage limit reached|${Math.floor(RESET.getTime() / 1000)}` };
    });
    const opencode = new Scripted('opencode', () => finish());
    const t1 = await addTask(ids['e2e-a']!, 'Hits the limit');
    const t2 = await addTask(ids['e2e-b']!, 'Waits for the reset');
    const t3 = await addTask(ids['e2e-oc']!, 'Other runtime');

    await executeRun(deps({ 'claude-cli': limited, opencode }), ws(), ids['e2e-a']!, 'manual');
    expect((await sql('select runtime from runtime_pauses where lifted_at is null')).rows.map((r) => r.runtime)).toEqual(['claude-cli']);
    expect((await taskRow(t1)).status).toBe('todo'); // queued, not blocked

    // Another agent on the same runtime does not even start; an agent on the other runtime runs as usual.
    const waiting = await executeRun(deps({ 'claude-cli': limited, opencode }), ws(), ids['e2e-b']!, 'manual');
    expect(waiting.status).toBe('not_runnable');
    expect(limited.starts).toBe(1);
    expect((await executeRun(deps({ 'claude-cli': limited, opencode }), ws(), ids['e2e-oc']!, 'manual')).status).toBe('succeeded');
    expect((await taskRow(t3)).status).toBe('done');

    // At the reset the pause lifts by itself, and the queued work runs.
    expect((await liftExpiredPauses({ pool: sys.app, workspaceId: ws(), now: () => new Date(RESET.getTime() - 60_000) })).lifted).toEqual([]);
    const after = new Date(RESET.getTime() + 60_000);
    const lifted = await liftExpiredPauses({ pool: sys.app, workspaceId: ws(), now: () => after });
    expect(lifted.lifted).toEqual(['claude-cli']);
    expect(lifted.agentsWithWork.sort()).toEqual([ids['e2e-a']!, ids['e2e-b']!].sort());
    const fine = new Scripted('claude-cli', () => finish());
    expect((await executeRun(deps({ 'claude-cli': fine }, after), ws(), ids['e2e-b']!, 'manual')).status).toBe('succeeded');
    expect((await taskRow(t2)).status).toBe('done');
  }, 60_000);

  it('(3) a skill change that hurts the sample leads is blocked by the gate', async () => {
    const set = loadSet('outreach');
    const baseline = baselineOf(set, await runEval(set, referenceDrafter));
    expect(compare(baseline, await runEval(set, referenceDrafter)).ok).toBe(true); // unchanged: stable

    // The skill change: drafts that run on and on, and hype the product.
    const worse = async (l: EvalLead) => `${await referenceDrafter(l)} ${'We are agentic and we deliver outcomes. '.repeat(40)}`;
    const gate = compare(baseline, await runEval(set, worse));
    expect(gate.ok).toBe(false);
    expect(gate.regressions).toHaveLength(20);
    expect(gate.regressions[0]!.reasons.join(' ')).toMatch(/170/);
    expect(gate.summary).toMatch(/20 of 20 leads got worse/);
  });
});
