import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { agentNew } from '../src/commands/agent-new';
import { Bus, type BusMessage } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let app: ReturnType<typeof createApp>;
let store: DbOsStore;
let agentId = '';
const bus = new Bus();
const heard: BusMessage[] = [];
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const list = async (query = '') => (await app.request(`/api/action-items${query}`)).json() as Promise<Item[]>;
const resolve = (id: string, body: unknown = {}) => app.request(`/api/action-items/${id}/resolve`, { method: 'POST', headers: json, body: JSON.stringify(body) });

interface Item {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  status: string;
  task_id: string | null;
  approval_id: string | null;
  derived?: boolean;
  resolution_note?: string | null;
}

beforeAll(async () => {
  ({ sys } = await testSystem());
  bus.subscribe((m) => heard.push(m));
  store = new DbOsStore(sys.app);
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
  await agentNew(sys, { template: 'outreach-rep', department: 'outreach', autonomy: 2 });
  agentId = (await sql("select id from agents where key = 'outreach-outreach-rep'")).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  heard.length = 0;
  await sql('delete from action_items');
  await sql("update tasks set status = 'done' where status = 'blocked'");
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
});

/** A task an agent is working on, so it can ask. */
async function runningTask(title = 'Find leads') {
  const t = (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, $2, 'in_progress', $3, 'founder') returning id", [ws(), title, agentId])).rows[0].id as string;
  const runId = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId, t])).rows[0].id as string;
  await sql('update tasks set locked_by = $2 where id = $1', [t, agentId]);
  return { taskId: t, scope: { workspaceId: ws(), agentId, runId, taskId: t } };
}

describe('action items (S1-9)', () => {
  it('starts empty', async () => {
    expect(await list()).toEqual([]);
  });

  it('an ask_founder call creates an item that points at the task and carries the question', async () => {
    const { taskId, scope } = await runningTask();
    await callOsTool(store, scope, 'ask_founder', { question: 'Which city should I start with?' });
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'question', status: 'open', task_id: taskId, body: 'Which city should I start with?' });
    expect(items[0]!.title).toMatch(/question/i);
  });

  it('resolving records who, when and the note, and unblocks nothing', async () => {
    const { taskId, scope } = await runningTask();
    await callOsTool(store, scope, 'ask_founder', { question: 'Which city?' });
    const [item] = await list();
    const res = await resolve(item!.id, { note: 'Lahore.' });
    expect(res.status).toBe(200);
    expect(heard.some((m) => m.kind === 'action_item.changed')).toBe(true);
    const row = (await sql('select status, resolved_by, resolved_at, resolution_note from action_items where id = $1', [item!.id])).rows[0];
    expect(row).toMatchObject({ status: 'done', resolved_by: 'founder', resolution_note: 'Lahore.' });
    expect(row.resolved_at).toBeTruthy();
    // The task is exactly as the agent left it: still blocked. Answering does not restart anything.
    expect((await sql('select status from tasks where id = $1', [taskId])).rows[0].status).toBe('blocked');
    expect((await sql("select action from audit_log where subject = $1 and action = 'action_item.resolved'", [item!.id])).rows).toHaveLength(1);
    expect((await list()).map((i) => i.id)).not.toContain(item!.id); // done items are not open
    expect((await list('?status=done')).map((i) => i.id)).toContain(item!.id);
  });

  it('resolving twice is refused and records nothing more', async () => {
    const { scope } = await runningTask();
    await callOsTool(store, scope, 'ask_founder', { question: 'Which?' });
    const [item] = await list();
    expect((await resolve(item!.id)).status).toBe(200);
    expect((await resolve(item!.id)).status).toBe(409);
    expect((await sql("select 1 from audit_log where subject = $1 and action = 'action_item.resolved'", [item!.id])).rows).toHaveLength(1);
  });

  it('answers 404 for an unknown or malformed id', async () => {
    expect((await resolve('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await resolve('nope')).status).toBe(404);
  });

  it('a failed approval appears once, however many times it is looked at or re-recorded', async () => {
    const lead = (await sql("insert into leads (workspace_id, business_name, email) values ($1, 'X', 'x@y.test') returning id", [ws()])).rows[0].id;
    const ap = (await sql("insert into approvals (workspace_id, kind, status, payload, dedupe_key) values ($1, 'email.send', 'failed', '{}', $2) returning id", [ws(), `t:${lead}`])).rows[0].id;
    const insert = () => sql("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', 'An approved email was not sent', 'why', $2) on conflict do nothing", [ws(), ap]);
    await insert();
    await insert();
    expect((await list()).filter((i) => i.approval_id === ap)).toHaveLength(1);
    expect((await sql('select count(*)::int as n from action_items where approval_id = $1 and kind = $2', [ap, 'executor_failed'])).rows[0].n).toBe(1);
  });

  it('shows a blocked task even when nobody asked a question, as an item that clears itself', async () => {
    const { taskId, scope } = await runningTask('Write copy');
    await callOsTool(store, scope, 'block_task', { reason: 'No brand voice document.' });
    const items = await list();
    const blocked = items.find((i) => i.kind === 'blocked_task');
    expect(blocked).toMatchObject({ derived: true, task_id: taskId, body: 'No brand voice document.' });
    expect((await resolve(blocked!.id)).status).toBe(404); // it is not a record; unblock the task instead
    await sql("update tasks set status = 'todo', blocked_reason = null where id = $1", [taskId]);
    expect((await list()).find((i) => i.kind === 'blocked_task')).toBeUndefined();
  });

  it('does not list a task twice when its block came from a question', async () => {
    const { scope } = await runningTask();
    await callOsTool(store, scope, 'ask_founder', { question: 'Which?' });
    const kinds = (await list()).map((i) => i.kind);
    expect(kinds).toEqual(['question']);
  });

  it('shows the kill switch while it is on, and not after', async () => {
    await sql('update workspace_settings set kill_switch = 1');
    expect((await list()).find((i) => i.kind === 'kill_switch')).toMatchObject({ derived: true, status: 'open' });
    await sql('update workspace_settings set kill_switch = 0');
    expect((await list()).find((i) => i.kind === 'kill_switch')).toBeUndefined();
  });
});
