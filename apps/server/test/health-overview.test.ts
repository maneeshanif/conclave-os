import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { Breakers } from '../src/harness/breakers';
import { ReaperStatus } from '../src/health';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let a1 = '';
let a2 = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const reaper = new ReaperStatus();

const app = () =>
  createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), breakers: new Breakers({ pool: sys.app, workspaceId: ws() }), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), reaperStatus: reaper });
interface Overview {
  windowHours: number;
  killSwitch: { on: boolean; at: string | null };
  queue: { todo: number; in_progress: number; blocked: number };
  agents: { key: string; runs: number; failed: number; failureRate: number | null; spentThisMonth: number; budget: number; overBudget: boolean }[];
  breakers: { key: string; lastError: string | null }[];
  pauses: { runtime: string; label: string }[];
  reaper: { at: string; reaped: number; requeued: number; blocked: number } | null;
  database: { sizeBytes: number };
  reroutes: { agent: string; from: string; to: string; reason: string }[];
}
const overview = async (q = '') => (await (await app().request(`/api/health/overview${q}`)).json()) as Overview;
const run = (agent: string, status: string, hoursAgo: number, usd = 0) =>
  sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at, ended_at, cost_usd) values ($1, $2, 'manual', 'claude-cli', $3, now() - ($4 || ' hours')::interval, now() - ($4 || ' hours')::interval, $5)", [ws(), agent, status, String(hoursAgo), usd]);
const task = (agent: string, status: string) => sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, 'T', $2, $3, 'founder')", [ws(), status, agent]);

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'health-one' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'health-two' });
  a1 = (await sql("select id from agents where key = 'health-one'")).rows[0].id;
  a2 = (await sql("select id from agents where key = 'health-two'")).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0, kill_switch_at = null', [ws()]);
  for (const t of ['run_events', 'approvals', 'runs', 'circuit_breakers', 'runtime_pauses']) await sql(`delete from ${t}`);
  await sql('delete from messages where task_id in (select id from tasks)');
  await sql('delete from tasks');
  await sql('update agents set monthly_budget_usd = 0');
  reaper.clear();
});

describe('GET /api/health/overview (S3-7)', () => {
  it('has an empty state that is all zeros and says nothing is wrong', async () => {
    const o = await overview();
    expect(o.killSwitch.on).toBe(false);
    expect(o.queue).toEqual({ todo: 0, in_progress: 0, blocked: 0 });
    expect(o.breakers).toEqual([]);
    expect(o.pauses).toEqual([]);
    expect(o.reaper).toBeNull();
    expect(o.database.sizeBytes).toBeGreaterThan(0);
    for (const a of o.agents) expect(a).toMatchObject({ runs: 0, failed: 0, failureRate: null, overBudget: false });
  });

  it('counts the queue and the runs in the window, with the failure rate by agent', async () => {
    await task(a1, 'todo');
    await task(a1, 'todo');
    await task(a2, 'in_progress');
    await task(a2, 'blocked');
    await task(a2, 'done'); // finished work is not queue
    await run(a1, 'succeeded', 1);
    await run(a1, 'succeeded', 2);
    await run(a1, 'succeeded', 3);
    await run(a1, 'failed', 4);
    await run(a1, 'failed', 30); // outside a 24-hour window
    await run(a2, 'timed_out', 1);
    const o = await overview();
    expect(o.queue).toEqual({ todo: 2, in_progress: 1, blocked: 1 });
    const one = o.agents.find((a) => a.key === 'health-one')!;
    expect(one).toMatchObject({ runs: 4, failed: 1, failureRate: 0.25 });
    expect(o.agents.find((a) => a.key === 'health-two')).toMatchObject({ runs: 1, failed: 1, failureRate: 1 });
    expect((await overview('?hours=48')).agents.find((a) => a.key === 'health-one')).toMatchObject({ runs: 5, failed: 2 });
  });

  it('shows spend this month against the budget, and flags an agent that is over', async () => {
    await sql('update agents set monthly_budget_usd = 5 where id = $1', [a1]);
    await sql('update agents set monthly_budget_usd = 5 where id = $1', [a2]);
    await run(a1, 'succeeded', 1, 5.25);
    await run(a2, 'succeeded', 1, 1.5);
    const o = await overview();
    expect(o.agents.find((a) => a.key === 'health-one')).toMatchObject({ spentThisMonth: 5.25, budget: 5, overBudget: true });
    expect(o.agents.find((a) => a.key === 'health-two')).toMatchObject({ spentThisMonth: 1.5, budget: 5, overBudget: false });
  });

  it('shows an open breaker, a paused runtime, the kill switch and the last reaper pass', async () => {
    const b = new Breakers({ pool: sys.app, workspaceId: ws() });
    for (let i = 0; i < 3; i++) await b.failure('os:add_lead', 'connection refused');
    await b.failure('os:score_lead', 'only once'); // not open: not listed
    await sql("insert into runtime_pauses (workspace_id, runtime, until, reason) values ($1, 'claude-cli', now() + interval '2 hours', 'usage limit')", [ws()]);
    await sql('update workspace_settings set kill_switch = 1, kill_switch_at = now() where workspace_id = $1', [ws()]);
    reaper.record({ reaped: [{}, {}] as never, requeued: [{}] as never, blocked: [] as never });
    const o = await overview();
    expect(o.breakers.map((x) => x.key)).toEqual(['os:add_lead']);
    expect(o.breakers[0]!.lastError).toBe('connection refused');
    expect(o.pauses).toHaveLength(1);
    expect(o.pauses[0]).toMatchObject({ runtime: 'claude-cli' });
    expect(o.killSwitch.on).toBe(true);
    expect(o.killSwitch.at).toBeTruthy();
    expect(o.reaper).toMatchObject({ reaped: 2, requeued: 1, blocked: 0 });
    expect(o.reaper!.at).toBeTruthy();
  });

  it('lists the runs that were moved to another engine in the window, newest first', async () => {
    const mk = async (hoursAgo: number) => {
      const run = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at) values ($1, $2, 'manual', 'openai-agents', 'succeeded', now() - ($3 || ' hours')::interval) returning id", [ws(), a1, String(hoursAgo)])).rows[0].id;
      await sql("insert into run_events (workspace_id, run_id, type, data, at) values ($1, $2, 'reroute', $3, now() - ($4 || ' hours')::interval)", [ws(), run, JSON.stringify({ from: 'claude-cli', to: 'openai-agents', reason: 'paused' }), String(hoursAgo)]);
    };
    await mk(30); // outside a 24-hour window
    await mk(2);
    const o = await overview();
    expect(o.reroutes).toHaveLength(1);
    expect(o.reroutes[0]).toMatchObject({ agent: 'health-one', from: 'claude-cli', to: 'openai-agents', reason: 'paused' });
    expect((await overview('?hours=48')).reroutes).toHaveLength(2);
  });

  it('refuses a silly window', async () => {
    expect((await app().request('/api/health/overview?hours=0')).status).toBe(400);
    expect((await app().request('/api/health/overview?hours=abc')).status).toBe(400);
  });
});
