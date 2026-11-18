import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { runWatchdog } from '../src/tasks/watchdog';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** The task watchdog (A7, optional, opt-in): a task that stopped wrongly is found and put back once. */
let sys: System;
let agentId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const NOW = new Date('2026-11-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const task = async (title: string, status: string, over: { lockedHoursAgo?: number; doneHoursAgo?: number } = {}) =>
  (await sql('insert into tasks (workspace_id, title, status, assignee_id, locked_by, locked_at, done_at, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id', [ws(), title, status, agentId, over.lockedHoursAgo !== undefined ? agentId : null, over.lockedHoursAgo !== undefined ? hoursAgo(over.lockedHoursAgo) : null, over.doneHoursAgo !== undefined ? hoursAgo(over.doneHoursAgo) : null, 'founder'])).rows[0].id as string;
const statusOf = async (id: string) => (await sql('select status, locked_by from tasks where id = $1', [id])).rows[0] as { status: string; locked_by: string | null };

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'writer', department: 'outreach', id: 'dog-w', name: 'Dot' });
  agentId = (await sql("select id from agents where key = 'dog-w'")).rows[0].id;
}, 240_000);
afterAll(() => sys?.close());

describe('the task watchdog (A7)', () => {
  it('does nothing while it is switched off, which it is by default', async () => {
    const t = await task('Stuck one', 'in_progress', { lockedHoursAgo: 5 });
    expect(await runWatchdog(sys.app, ws(), NOW)).toEqual([]);
    expect((await statusOf(t)).status).toBe('in_progress');
    await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do nothing', [ws()]);
    await sql('update workspace_settings set task_watchdog = true');
  });

  it('puts back a task stuck in progress with no run going, and leaves one that has a run alive', async () => {
    const live = await task('Being worked on', 'in_progress', { lockedHoursAgo: 5 });
    await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status, started_at) values ($1, $2, $3, 'task', 'claude-cli', 'running', $4)", [ws(), agentId, live, hoursAgo(1)]);
    const fresh = await task('Just started', 'in_progress', { lockedHoursAgo: 0.5 });
    const found = await runWatchdog(sys.app, ws(), NOW);
    expect(found.map((f) => f.title)).toEqual(['Stuck one']);
    expect(found[0]).toMatchObject({ reason: 'stuck_in_progress' });
    expect((await statusOf(live)).status).toBe('in_progress');
    expect((await statusOf(fresh)).status).toBe('in_progress');
    const stuck = (await sql("select id from tasks where title = 'Stuck one'")).rows[0].id as string;
    expect(await statusOf(stuck)).toEqual({ status: 'todo', locked_by: null });
    expect((await sql('select body from messages where task_id = $1', [stuck])).rows[0].body).toMatch(/watchdog/i);
  });

  it('puts back a task declared done with nothing from the agent to show for it, but not one with a result', async () => {
    const bare = await task('Done on paper', 'done', { doneHoursAgo: 2 });
    const proven = await task('Done with proof', 'done', { doneHoursAgo: 2 });
    await sql("insert into messages (workspace_id, task_id, from_id, body) values ($1, $2, 'agent:dog-w', 'Here is the result.')", [ws(), proven]);
    const found = await runWatchdog(sys.app, ws(), NOW);
    expect(found.map((f) => f.reason)).toEqual(['done_without_proof']);
    expect((await statusOf(bare)).status).toBe('todo');
    expect((await statusOf(proven)).status).toBe('done');
  });

  it('puts back a task waiting for an approval that is not pending any more', async () => {
    const waiting = await task('Waiting for nothing', 'waiting_approval');
    const real = await task('Waiting for real', 'waiting_approval');
    await sql("insert into approvals (workspace_id, kind, dedupe_key, task_id, payload, status) values ($1, 'email.send', 'wd1', $2, '{}', 'pending')", [ws(), real]);
    const found = await runWatchdog(sys.app, ws(), NOW);
    expect(found.map((f) => `${f.title}:${f.reason}`)).toEqual(['Waiting for nothing:waiting_with_nothing']);
    expect((await statusOf(waiting)).status).toBe('todo');
    expect((await statusOf(real)).status).toBe('waiting_approval');
  });

  it('puts a task back only once, so it cannot loop forever, and the second stop is left for a person', async () => {
    const t = await task('Keeps stopping', 'in_progress', { lockedHoursAgo: 6 });
    expect((await runWatchdog(sys.app, ws(), NOW)).map((f) => f.title)).toEqual(['Keeps stopping']);
    await sql("update tasks set status = 'in_progress', locked_by = $2, locked_at = $3 where id = $1", [t, agentId, hoursAgo(6)]);
    expect(await runWatchdog(sys.app, ws(), NOW)).toEqual([]);
    expect((await statusOf(t)).status).toBe('in_progress');
    expect((await sql("select count(*)::int as n from action_items where kind = 'watchdog' and body like $1", [`%${t}%`])).rows[0].n).toBe(1);
  });
});
