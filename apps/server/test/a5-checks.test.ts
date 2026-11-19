import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { checkBudget } from '../src/harness/budget';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** Small checks from the borrow audit (A5): a hand-off ends a run's hold on the task (P7), and spend can be corrected and reconciled (P8). */
let sys: System;
let store: DbOsStore;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const idOf = async (key: string) => (await sql('select id from agents where key = $1', [key])).rows[0].id as string;

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'writer', department: 'outreach', id: 'a5-one', name: 'One' });
  await agentNew(sys, { template: 'writer', department: 'outreach', id: 'a5-two', name: 'Two' });
  await sql("update agents set autonomy = 1, status = 'active' where key in ('a5-one','a5-two')");
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
}, 240_000);
afterAll(() => sys?.close());

describe('a run handed off to a colleague can no longer change the task (A5, P7)', () => {
  it('is refused for every tool that changes the task once the hand-off is done', async () => {
    const one = await idOf('a5-one');
    const two = await idOf('a5-two');
    const task = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 'Write it', 'in_progress', $2, $2, 'founder') returning id", [ws(), one])).rows[0].id as string;
    const run = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'task', 'claude-cli', 'running') returning id", [ws(), one, task])).rows[0].id as string;
    const scope = { workspaceId: ws(), agentId: one, runId: run, taskId: task };
    await callOsTool(store, scope, 'hand_off_task', { to: 'a5-two', note: 'Over to you.' });
    expect((await sql('select assignee_id, status, locked_by from tasks where id = $1', [task])).rows[0]).toMatchObject({ assignee_id: two, status: 'todo', locked_by: null });
    for (const [tool, args] of [['complete_task', { output: 'Done.' }], ['block_task', { reason: 'x' }], ['comment', { text: 'still here' }], ['ask_founder', { question: 'why?' }], ['hand_off_task', { to: 'a5-two', note: 'again' }]] as const) {
      await expect(callOsTool(store, scope, tool, args), tool).rejects.toThrow(/not in progress|not held/);
    }
    expect((await sql('select status, assignee_id from tasks where id = $1', [task])).rows[0]).toMatchObject({ status: 'todo', assignee_id: two });
    expect((await sql('select count(*)::int as n from messages where task_id = $1 and from_id = $2', [task, 'agent:a5-one'])).rows[0].n).toBe(1); // only the hand-off note
  });

  it('also holds when a person moves the task: the old run cannot finish it', async () => {
    const one = await idOf('a5-one');
    const task = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 'Mine now', 'in_progress', $2, $2, 'founder') returning id", [ws(), one])).rows[0].id as string;
    const run = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'task', 'claude-cli', 'running') returning id", [ws(), one, task])).rows[0].id as string;
    await sql("update tasks set status = 'blocked', locked_by = null where id = $1", [task]);
    await expect(callOsTool(store, { workspaceId: ws(), agentId: one, runId: run, taskId: task }, 'complete_task', { output: 'Done.' })).rejects.toThrow(/not in progress/);
  });
});

describe('spend can be corrected and reconciled (A5, P8)', () => {
  it('counts a correction in the month\'s spend, keeps the run rows as they were, and records who and why', async () => {
    const one = await idOf('a5-one');
    await sql("update agents set monthly_budget_usd = 10 where id = $1", [one]);
    await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at, cost_usd) values ($1, $2, 'task', 'claude-cli', 'succeeded', now(), 4.00)", [ws(), one]);
    const agent = { id: one, key: 'a5-one', name: 'One', monthly_budget_usd: '10' };
    expect(await checkBudget(sys.app, ws(), agent, new Date())).toMatchObject({ spent: 4, over: false });
    // The CLI over-reported a run by 1.50: a correction takes it off without touching the run row.
    await sql("insert into spend_adjustments (workspace_id, agent_id, usd, reason, created_by) values ($1, $2, -1.50, 'The CLI double counted one run', 'founder')", [ws(), one]);
    expect(await checkBudget(sys.app, ws(), agent, new Date())).toMatchObject({ spent: 2.5, over: false });
    expect(Number((await sql('select sum(cost_usd) as s from runs where agent_id = $1', [one])).rows[0].s)).toBe(4);
    // A correction can also add: spend that happened outside a run.
    await sql("insert into spend_adjustments (workspace_id, agent_id, usd, reason, created_by) values ($1, $2, 8.00, 'Paid for an image by hand', 'founder')", [ws(), one]);
    expect(await checkBudget(sys.app, ws(), agent, new Date())).toMatchObject({ spent: 10.5, over: true });
  });

  it('only counts corrections made this month, and never lets the spend go below zero', async () => {
    const two = await idOf('a5-two');
    const agent = { id: two, key: 'a5-two', name: 'Two', monthly_budget_usd: '10' };
    await sql("insert into spend_adjustments (workspace_id, agent_id, usd, reason, created_by, created_at) values ($1, $2, 50, 'Last month', 'founder', now() - interval '45 days')", [ws(), two]);
    expect((await checkBudget(sys.app, ws(), agent, new Date())).spent).toBe(0);
    await sql("insert into spend_adjustments (workspace_id, agent_id, usd, reason, created_by) values ($1, $2, -5, 'Too much taken off', 'founder')", [ws(), two]);
    expect((await checkBudget(sys.app, ws(), agent, new Date())).spent).toBe(0);
  });
});
