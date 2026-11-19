import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { closeBudgetItems, monthStart } from '../src/harness/budget';
import { executeRun, type LoopDeps } from '../src/harness/loop';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { Runtime, RunEvent } from '../src/runtimes/types';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

const NOW = new Date(2026, 10, 15, 12, 0, 0); // 15 November 2026, local time
let sys: System;
let a1 = '';
let a2 = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

class Scripted implements Runtime {
  name = 'claude-cli' as const;
  canResume = true;
  starts = 0;
  constructor(private usd = 0) {}
  async *start(): AsyncIterable<RunEvent> {
    this.starts++;
    if (this.usd) yield { type: 'cost', usd: this.usd, tokensIn: 100, tokensOut: 50 };
    yield { type: 'done', output: 'ok' };
  }
  async cancel() {}
  async health() {
    return { ok: true };
  }
}
const deps = (rt: Runtime, now = NOW): LoopDeps => ({ pool: sys.app, tokens: new RunTokens(), bus: new Bus(), runtimes: { 'claude-cli': rt }, dataDir: sys.dataDir, workspaceSlug: sys.workspace.slug, templatesRoot: sys.templatesRoot, timeoutMs: 30_000, now: () => now });
const addTask = async (agent: string, title = 'Work') => (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, $2, 'todo', $3, 'founder') returning id", [ws(), title, agent])).rows[0].id as string;
const spend = (agent: string, usd: number, startedAt = NOW) => sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at, ended_at, cost_usd) values ($1, $2, 'manual', 'claude-cli', 'succeeded', $3, $3, $4)", [ws(), agent, startedAt, usd]);
const items = async () => (await sql("select status, title, body from action_items where kind = 'budget_exhausted' order by created_at")).rows;
const status = async (t: string) => (await sql('select status, locked_by from tasks where id = $1', [t])).rows[0];

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'bud-1' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'bud-2' });
  a1 = (await sql("select id from agents where key = 'bud-1'")).rows[0].id;
  a2 = (await sql("select id from agents where key = 'bud-2'")).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  await sql('delete from run_events');
  await sql('delete from runs');
  await sql('delete from messages where task_id in (select id from tasks where assignee_id = any($1))', [[a1, a2]]);
  await sql('delete from tasks where assignee_id = any($1)', [[a1, a2]]);
  await sql("delete from action_items where kind = 'budget_exhausted'");
  await sql('update agents set monthly_budget_usd = 5 where id = any($1)', [[a1, a2]]);
});

describe('the month (S3-4)', () => {
  it('starts on the first of the month, local time', () => {
    expect(monthStart(new Date(2026, 10, 15, 12))).toEqual(new Date(2026, 10, 1));
    expect(monthStart(new Date(2026, 11, 31, 23, 59))).toEqual(new Date(2026, 11, 1));
  });
});

describe('a budget is checked before every run (S3-4)', () => {
  it('lets an agent under its budget run, and counts what the run cost', async () => {
    const rt = new Scripted(2.5);
    const t = await addTask(a1);
    expect((await executeRun(deps(rt), ws(), a1, 'manual')).status).toBe('succeeded');
    expect((await status(t)).status).toBe('done');
    expect(Number((await sql('select cost_usd from runs where agent_id = $1', [a1])).rows[0].cost_usd)).toBeCloseTo(2.5, 5);
  });

  it('does not start a run once the month\'s spending has reached the budget; no task is taken', async () => {
    await spend(a1, 5); // exactly the budget
    const rt = new Scripted();
    const t = await addTask(a1);
    const out = await executeRun(deps(rt), ws(), a1, 'manual');
    expect(out).toMatchObject({ status: 'not_runnable', reason: expect.stringMatching(/over its budget/i) });
    expect(rt.starts).toBe(0);
    expect(await status(t)).toMatchObject({ status: 'todo', locked_by: null });
  });

  it('raises one action item, naming the agent and the numbers, however often it is asked to run', async () => {
    await spend(a1, 6.25);
    for (let i = 0; i < 3; i++) await executeRun(deps(new Scripted()), ws(), a1, 'manual');
    const its = await items();
    expect(its).toHaveLength(1);
    expect(its[0]!.title).toMatch(/bud-1|Researcher/i);
    expect(its[0]!.body).toMatch(/6\.25/);
    expect(its[0]!.body).toMatch(/\$5\b|5\.00/);
    expect(its[0]!.status).toBe('open');
  });

  it('counts only this month: last month\'s spending does not hold an agent back', async () => {
    await spend(a1, 50, new Date(2026, 9, 20)); // October
    const t = await addTask(a1);
    expect((await executeRun(deps(new Scripted()), ws(), a1, 'manual')).status).toBe('succeeded');
    expect((await status(t)).status).toBe('done');
  });

  it('is per agent: one agent over its budget does not stop another', async () => {
    await spend(a1, 9);
    const t = await addTask(a2);
    expect((await executeRun(deps(new Scripted()), ws(), a2, 'manual')).status).toBe('succeeded');
    expect((await status(t)).status).toBe('done');
  });

  it('refuses the run that follows the one that used the budget up', async () => {
    const rt = new Scripted(3);
    await addTask(a1, 'one');
    await addTask(a1, 'two');
    await addTask(a1, 'three');
    expect((await executeRun(deps(rt), ws(), a1, 'manual')).status).toBe('succeeded'); // spent 0 -> 3
    expect((await executeRun(deps(rt), ws(), a1, 'manual')).status).toBe('succeeded'); // spent 3 -> 6
    expect((await executeRun(deps(rt), ws(), a1, 'manual')).status).toBe('not_runnable'); // 6 is over 5
    expect(rt.starts).toBe(2);
  });

  it('treats a budget of zero as nothing allowed', async () => {
    await sql('update agents set monthly_budget_usd = 0 where id = $1', [a1]);
    expect((await executeRun(deps(new Scripted()), ws(), a1, 'manual')).status).toBe('not_runnable');
  });
});

describe('lifting it (S3-4)', () => {
  it('a raised budget lets the agent run again, and the ticker closes the item and wakes the agent', async () => {
    await spend(a1, 6);
    const t = await addTask(a1);
    await executeRun(deps(new Scripted()), ws(), a1, 'manual');
    expect(await items()).toHaveLength(1);
    expect(await closeBudgetItems({ pool: sys.app, workspaceId: ws(), now: () => NOW })).toEqual({ closed: 0, agentsWithWork: [] }); // still over

    await sql('update agents set monthly_budget_usd = 20 where id = $1', [a1]); // the role file's number was raised and synced
    const r = await closeBudgetItems({ pool: sys.app, workspaceId: ws(), now: () => NOW });
    expect(r).toEqual({ closed: 1, agentsWithWork: [a1] });
    expect((await items())[0]!.status).toBe('done');
    expect((await executeRun(deps(new Scripted()), ws(), a1, 'manual')).status).toBe('succeeded');
    expect((await status(t)).status).toBe('done');
  });

  it('a new month starts a new total, and closes the item by itself', async () => {
    await spend(a1, 6);
    await executeRun(deps(new Scripted()), ws(), a1, 'manual');
    const december = new Date(2026, 11, 2, 9, 0, 0);
    expect((await closeBudgetItems({ pool: sys.app, workspaceId: ws(), now: () => december })).closed).toBe(1);
    const t = await addTask(a1);
    expect((await executeRun(deps(new Scripted(), december), ws(), a1, 'manual')).status).toBe('succeeded');
    expect((await status(t)).status).toBe('done');
  });

  it('asks again next month if it goes over again (a new item, not the old one reopened)', async () => {
    await spend(a1, 6);
    await executeRun(deps(new Scripted()), ws(), a1, 'manual');
    const december = new Date(2026, 11, 2, 9, 0, 0);
    await closeBudgetItems({ pool: sys.app, workspaceId: ws(), now: () => december });
    await spend(a1, 7, december);
    await executeRun(deps(new Scripted(), december), ws(), a1, 'manual');
    expect((await items()).map((i) => i.status)).toEqual(['done', 'open']);
  });
});

describe('reloading the company file (S3-4)', () => {
  it('runs the sync on request, so a raised budget in a role file takes effect without a restart', async () => {
    let calls = 0;
    const app = createApp({
      pool: sys.app,
      workspaceId: ws(),
      tokens: new RunTokens(),
      store: new MemoryOsStore(),
      bus: new Bus(),
      dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })),
      onCompanyReload: async () => {
        calls++;
        return { departments: 3, agents: 2, funnels: 2, goals: 5 };
      },
    });
    const res = await app.request('/api/company/reload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ agents: 2, funnels: 2 });
    expect(calls).toBe(1);
  });

  it('says plainly when a file is wrong, and changes nothing', async () => {
    const app = createApp({
      pool: sys.app,
      workspaceId: ws(),
      tokens: new RunTokens(),
      store: new MemoryOsStore(),
      bus: new Bus(),
      dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })),
      onCompanyReload: async () => {
        throw new Error('goals.yaml: current_rung "rung-9" is not on the ladder');
      },
    });
    const res = await app.request('/api/company/reload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/goals\.yaml/);
  });
});
