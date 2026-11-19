import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { failureClass } from '../src/harness/failure';
import { executeRun, type LoopDeps } from '../src/harness/loop';
import { RunTokens } from '../src/harness/run-tokens';
import { withSilenceWatchdog } from '../src/harness/silence';
import type { Runtime, RunEvent, RunRequest } from '../src/runtimes/types';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function collect<T>(it: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('withSilenceWatchdog (S5-5b)', () => {
  it('passes events through untouched while they keep coming, however long the whole run takes', async () => {
    async function* steady() {
      for (let i = 0; i < 6; i++) {
        await sleep(40);
        yield i;
      }
    }
    let silent = 0;
    expect(await collect(withSilenceWatchdog(steady(), 120, () => void silent++, () => -1))).toEqual([0, 1, 2, 3, 4, 5]); // 240 ms in all, never 120 ms quiet
    expect(silent).toBe(0);
  });

  it('stops a source that goes quiet, calls onSilent once, and ends with the silent event, without waiting for the source to finish', async () => {
    async function* hangs() {
      yield 'first';
      await new Promise(() => undefined); // never yields again, never ends
    }
    let silent = 0;
    const started = Date.now();
    const out = await collect(withSilenceWatchdog(hangs(), 80, () => void silent++, (ms) => `silent after ${ms}`));
    expect(out).toEqual(['first', 'silent after 80']);
    expect(silent).toBe(1);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('counts silence from the last event, not from the start', async () => {
    async function* slowStart() {
      await sleep(100);
      yield 'a';
      await sleep(100);
      yield 'b';
    }
    // 200 ms in all, but never 150 ms without an event.
    expect(await collect(withSilenceWatchdog(slowStart(), 150, () => undefined, () => 'silent'))).toEqual(['a', 'b']);
  });

  it('does nothing when the threshold is zero or less (switched off)', async () => {
    async function* s() {
      await sleep(60);
      yield 1;
    }
    expect(await collect(withSilenceWatchdog(s(), 0, () => undefined, () => -1))).toEqual([1]);
  });

  it('passes an error from the source on, and a source that ends early ends cleanly', async () => {
    async function* boom() {
      yield 1;
      throw new Error('crashed');
    }
    await expect(collect(withSilenceWatchdog(boom(), 500, () => undefined, () => -1))).rejects.toThrow('crashed');
    async function* none() {}
    expect(await collect(withSilenceWatchdog(none(), 500, () => undefined, () => -1))).toEqual([]);
  });
});

describe('in the run loop (S5-5b)', () => {
  let sys: System;
  let agentId = '';
  const ws = () => sys.workspace.id;
  const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

  class Quiet implements Runtime {
    name = 'claude-cli' as const;
    canResume = true;
    cancelled: string[] = [];
    starts = 0;
    constructor(private readonly behaviour: (n: number) => 'hang' | 'ok' | 'chatty') {}
    async *start(req: RunRequest): AsyncIterable<RunEvent> {
      const how = this.behaviour(++this.starts);
      yield { type: 'session', sessionId: `s${this.starts}` };
      if (how === 'hang') await new Promise(() => undefined);
      if (how === 'chatty') for (let i = 0; i < 6; i++) { await sleep(60); yield { type: 'message', text: `step ${i}` }; }
      void req;
      yield { type: 'done', output: 'finished' };
    }
    async cancel(runId: string) {
      this.cancelled.push(runId);
    }
    async health() {
      return { ok: true };
    }
  }
  const deps = (rt: Runtime, over: Partial<LoopDeps> = {}): LoopDeps => ({ pool: sys.app, tokens: new RunTokens(), bus: { publish: () => undefined } as never, runtimes: { 'claude-cli': rt }, dataDir: sys.dataDir, workspaceSlug: sys.workspace.slug, templatesRoot: sys.templatesRoot, timeoutMs: 30_000, silenceMs: 250, ...over });
  const task = async () => (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, 'T', 'todo', $2, 'founder') returning id", [ws(), agentId])).rows[0].id as string;

  beforeAll(async () => {
    ({ sys } = await testSystem());
    await agentNew(sys, { template: 'researcher', department: 'research', id: 'silent-agent' });
    agentId = (await sql("select id from agents where key = 'silent-agent'")).rows[0].id;
  }, 240_000);
  afterAll(async () => sys?.close());
  beforeEach(async () => {
    await sql('delete from run_events');
    await sql('delete from runs');
    await sql('delete from messages');
    await sql('delete from tasks');
  });

  it('classes the silent kind as worth another try, and a plain hang timeout as not', () => {
    expect(failureClass({ kind: 'silent', message: 'no output for 5 minutes' })).toBe('transient');
    expect(failureClass({ kind: 'timeout', message: 'took too long' })).toBe('permanent');
  });

  it('stops a run that goes quiet after its first event: cancels the runtime, ends with the silent error kind, blocks the task with the reason', async () => {
    const rt = new Quiet(() => 'hang');
    const t = await task();
    const started = Date.now();
    const out = await executeRun(deps(rt), ws(), agentId, 'manual');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(out).toMatchObject({ status: 'failed', error: { kind: 'silent' } });
    expect(rt.cancelled).toHaveLength(1);
    const run = (await sql('select status, error from runs where task_id = $1', [t])).rows[0];
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/^silent: .*no output for/);
    expect((await sql('select status, blocked_reason from tasks where id = $1', [t])).rows[0]).toMatchObject({ status: 'blocked', blocked_reason: expect.stringMatching(/silent/) });
    expect((await sql("select data from run_events where type = 'error'")).rows[0].data).toMatchObject({ kind: 'silent' });
  }, 30_000);

  it('does not touch a run that keeps producing events, even when it takes longer than the threshold in all', async () => {
    const rt = new Quiet(() => 'chatty');
    const t = await task();
    expect((await executeRun(deps(rt), ws(), agentId, 'manual')).status).toBe('succeeded'); // ~360 ms of events against a 250 ms threshold
    expect(rt.cancelled).toHaveLength(0);
    expect((await sql('select status from tasks where id = $1', [t])).rows[0].status).toBe('done');
  }, 30_000);

  it('retries a silent run like any transient failure: the second attempt finishes the task', async () => {
    const rt = new Quiet((n) => (n === 1 ? 'hang' : 'ok'));
    const t = await task();
    const out = await executeRun(deps(rt, { retry: { delaysMs: [0], sleep: async () => undefined } }), ws(), agentId, 'manual');
    expect(out.status).toBe('succeeded');
    expect(rt.starts).toBe(2);
    expect((await sql('select status from tasks where id = $1', [t])).rows[0].status).toBe('done');
  }, 30_000);

  it('is off when the threshold is zero', async () => {
    const rt = new Quiet(() => 'ok');
    await task();
    expect((await executeRun(deps(rt, { silenceMs: 0 }), ws(), agentId, 'manual')).status).toBe('succeeded');
  });
});
