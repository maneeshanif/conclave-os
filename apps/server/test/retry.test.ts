import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { failureClass } from '../src/harness/failure';
import { executeRun, type LoopDeps } from '../src/harness/loop';
import { RunTokens } from '../src/harness/run-tokens';
import type { ErrorKind, Runtime, RunEvent, RunRequest } from '../src/runtimes/types';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

describe('what kind of failure it is (S3-2)', () => {
  it.each([
    ['limit', 'Rate limit exceeded: too many requests (429)', 'transient'],
    ['runtime', 'API Error: 529 Overloaded', 'transient'],
    ['runtime', 'fetch failed: ECONNRESET', 'transient'],
    ['runtime', '503 Service Unavailable', 'transient'],
    ['limit', 'Claude AI usage limit reached|1794500000', 'plan_limit'],
    ['limit', 'You have hit your limit, resets 3pm', 'plan_limit'],
    ['runtime', 'quota exceeded for this month', 'plan_limit'],
    ['auth', 'Invalid API key', 'auth'],
    ['runtime', 'boom: something broke', 'permanent'],
    ['config', 'bad model alias', 'permanent'],
    ['max_turns', 'ran out of turns', 'permanent'],
    ['timeout', 'took too long', 'permanent'],
    ['cancelled', 'killed', 'permanent'],
  ] as [ErrorKind, string, string][])('%s "%s" is %s', (kind, message, expected) => {
    expect(failureClass({ kind, message })).toBe(expected);
  });
});

let sys: System;
let agentId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

/** A runtime that follows a script: one entry per attempt, in order. */
class Scripted implements Runtime {
  name = 'claude-cli' as const;
  canResume = true;
  requests: RunRequest[] = [];
  constructor(private script: ((req: RunRequest) => RunEvent[])[]) {}
  async *start(req: RunRequest): AsyncIterable<RunEvent> {
    const step = this.script[Math.min(this.requests.length, this.script.length - 1)]!;
    this.requests.push(req);
    for (const e of step(req)) yield e;
  }
  async cancel() {}
  async health() {
    return { ok: true };
  }
}
const fail = (kind: ErrorKind, message: string, extra: RunEvent[] = []) => (): RunEvent[] => [{ type: 'session', sessionId: 'ses_1' }, ...extra, { type: 'error', kind, message }];
const succeed = (): RunEvent[] => [{ type: 'session', sessionId: 'ses_1' }, { type: 'done', output: 'all done' }];
const cost = (usd: number): RunEvent => ({ type: 'cost', usd, tokensIn: 10, tokensOut: 5 });

function deps(rt: Runtime, retry?: LoopDeps['retry']): LoopDeps {
  return { pool: sys.app, tokens: new RunTokens(), bus: new Bus(), runtimes: { 'claude-cli': rt }, dataDir: sys.dataDir, workspaceSlug: sys.workspace.slug, templatesRoot: sys.templatesRoot, timeoutMs: 30_000, ...(retry ? { retry } : {}) };
}
async function newTask() {
  return (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, 'Work', 'todo', $2, 'founder') returning id", [ws(), agentId])).rows[0].id as string;
}
const taskRow = async (id: string) => (await sql('select status, blocked_reason from tasks where id = $1', [id])).rows[0];
const events = async (taskId: string, type: string) => (await sql('select e.data from run_events e join runs r on r.id = e.run_id where r.task_id = $1 and e.type = $2 order by e.id', [taskId, type])).rows.map((r) => r.data);

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'retry-agent' });
  agentId = (await sql("select id from agents where key = 'retry-agent'")).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  await sql('delete from run_events');
  await sql('delete from runs');
  await sql('delete from messages where task_id in (select id from tasks where assignee_id = $1)', [agentId]);
  await sql('delete from tasks where assignee_id = $1', [agentId]);
  await sql("update agents set fallback_alias = null, status = 'active' where id = $1", [agentId]);
});

describe('retry and backoff (S3-2)', () => {
  it('retries a transient error with growing waits and carries on from the same session', async () => {
    const rt = new Scripted([fail('limit', 'Rate limit exceeded: too many requests (429)', [cost(0.1)]), fail('runtime', '529 Overloaded', [cost(0.2)]), succeed]);
    const waits: number[] = [];
    const t = await newTask();
    const out = await executeRun(deps(rt, { delaysMs: [1000, 4000, 16000], sleep: async (ms) => void waits.push(ms) }), ws(), agentId, 'manual');
    expect(out.status).toBe('succeeded');
    expect(waits).toEqual([1000, 4000]);
    expect(rt.requests).toHaveLength(3);
    expect(rt.requests[1]!.sessionId).toBe('ses_1'); // the retry resumes
    expect(rt.requests[2]!.sessionId).toBe('ses_1');
    expect(await events(t, 'retry')).toEqual([expect.objectContaining({ attempt: 1, waitMs: 1000 }), expect.objectContaining({ attempt: 2, waitMs: 4000 })]);
    expect((await taskRow(t)).status).toBe('done');
    // What every attempt cost is on the one run.
    expect(Number((await sql('select cost_usd from runs where task_id = $1', [t])).rows[0].cost_usd)).toBeCloseTo(0.3, 5);
  });

  it('goes to the fallback model after the retries, and succeeds there', async () => {
    await sql("update agents set fallback_alias = 'fallback-model' where id = $1", [agentId]);
    const rt = new Scripted([(req) => (req.modelAlias === 'fallback-model' ? succeed() : fail('runtime', '503 Service Unavailable')())]);
    await newTask();
    const out = await executeRun(deps(rt, { delaysMs: [0, 0], sleep: async () => undefined }), ws(), agentId, 'manual');
    expect(out.status).toBe('succeeded');
    const aliases = rt.requests.map((r) => r.modelAlias);
    expect(aliases.slice(0, 3)).toEqual([aliases[0], aliases[0], aliases[0]]); // the first try and two retries on the agent's own model
    expect(aliases[3]).toBe('fallback-model');
    expect(aliases).toHaveLength(4);
  });

  it('blocks the task, with what was tried, when everything fails', async () => {
    await sql("update agents set fallback_alias = 'fallback-model' where id = $1", [agentId]);
    const rt = new Scripted([fail('runtime', '503 Service Unavailable')]);
    const t = await newTask();
    const out = await executeRun(deps(rt, { delaysMs: [0, 0], sleep: async () => undefined }), ws(), agentId, 'manual');
    expect(out.status).toBe('failed');
    expect(rt.requests).toHaveLength(4);
    const task = await taskRow(t);
    expect(task.status).toBe('blocked');
    expect(task.blocked_reason).toMatch(/503 Service Unavailable/);
    expect(task.blocked_reason).toMatch(/after 4 attempts/);
    expect(task.blocked_reason).toMatch(/fallback model/);
  });

  it('retries without a fallback when the agent has none', async () => {
    const rt = new Scripted([fail('runtime', '503 Service Unavailable')]);
    await newTask();
    await executeRun(deps(rt, { delaysMs: [0, 0, 0], sleep: async () => undefined }), ws(), agentId, 'manual');
    expect(rt.requests).toHaveLength(4); // one try, three retries
  });

  it.each([
    ['an auth error', 'auth' as const, 'Invalid API key'],
    ['a crash', 'runtime' as const, 'boom: something broke'],
    ['a bad config', 'config' as const, 'bad model alias'],
    ['a plan limit', 'limit' as const, 'Claude AI usage limit reached|1794500000'],
    ['running out of turns', 'max_turns' as const, 'ran out of turns'],
  ])('does not retry %s: it fails at once', async (_n, kind, message) => {
    const rt = new Scripted([fail(kind, message)]);
    const t = await newTask();
    const out = await executeRun(deps(rt, { delaysMs: [0, 0], sleep: async () => undefined }), ws(), agentId, 'manual');
    expect(out.status).toBe('failed');
    expect(rt.requests).toHaveLength(1);
    expect((await taskRow(t)).status).toBe('blocked');
    expect((await taskRow(t)).blocked_reason).not.toMatch(/attempts/);
  });

  it('stops retrying the moment the kill switch goes on', async () => {
    const rt = new Scripted([fail('runtime', '503 Service Unavailable')]);
    await newTask();
    const out = await executeRun(
      deps(rt, {
        delaysMs: [0, 0, 0],
        sleep: async () => {
          await sql('update workspace_settings set kill_switch = 1');
        },
      }),
      ws(),
      agentId,
      'manual',
    );
    expect(out.status).toBe('failed');
    expect(rt.requests).toHaveLength(1); // the wait before the first retry turned the switch on, so there was no retry
  });

  it('does a single attempt when no retry is configured, as before', async () => {
    await newTask();
    const rt = new Scripted([fail('runtime', '503 Service Unavailable')]);
    await executeRun(deps(rt), ws(), agentId, 'manual');
    expect(rt.requests).toHaveLength(1);
  });
});
