import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';
import { rm } from 'node:fs/promises';
import path from 'node:path';

let sys: System;
let app: ReturnType<typeof createApp>;
let store: DbOsStore;
const ids: Record<string, string> = {};
const seen: BusMessage[] = [];
const changed: string[] = [];
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const get = (url: string) => app.request(url);
const post = (url: string, body: unknown) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
type Board = { department: { key: string; name: string }; agents: { key: string }[]; tasks: { id: string; title: string; status: string; assignee_key: string | null }[] };
type Channel = { messages: { id: string; author: string; body: string }[] };
const task = async (title: string, status: string, assignee: string | null, dept: string | null = null) =>
  (await sql('insert into tasks (workspace_id, title, status, assignee_id, department_id, created_by) values ($1, $2, $3, $4, (select id from departments where key = $5), $6) returning id', [ws(), title, status, assignee ? ids[assignee] : null, dept, 'founder'])).rows[0].id as string;
const scope = (agent: string, taskId: string) => ({ workspaceId: ws(), agentId: ids[agent]!, runId: '00000000-0000-4000-8000-000000000000', taskId });

beforeAll(async () => {
  ({ sys } = await testSystem());
  await rm(path.join(sys.companyRoot, 'departments'), { recursive: true, force: true });
  for (const [key, dept] of [['dw-a', 'outreach'], ['dw-b', 'outreach'], ['dw-c', 'research']] as const) {
    await agentNew(sys, { template: 'researcher', department: dept, id: key });
    ids[key] = (await sql('select id from agents where key = $1', [key])).rows[0].id;
  }
  // Creating an agent reads every role file again, which puts each autonomy back to the file's level, so raise them after all are made.
  for (const key of Object.keys(ids)) await sql('update agents set autonomy = 1 where id = $1', [ids[key]]);
  const bus = new Bus();
  bus.subscribe((m) => seen.push(m));
  store = new DbOsStore(sys.app, (_w, t) => changed.push(t), sys.companyRoot);
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot });
}, 240_000);
afterAll(async () => sys?.close());

describe('a department board (S6-13d)', () => {
  it('lists the department\'s open tasks, with who has each, and nobody else\'s, and not what is finished', async () => {
    await task('Write the follow-up', 'todo', 'dw-a');
    await task('Check the replies', 'in_progress', 'dw-b');
    await task('Nobody has this yet', 'blocked', null, 'outreach');
    await task('Research task', 'todo', 'dw-c');
    await task('Already done', 'done', 'dw-a');
    await task('Dropped', 'cancelled', 'dw-b');
    const r = await get('/api/departments/outreach/board');
    expect(r.status).toBe(200);
    const b = (await r.json()) as Board;
    expect(b.department).toMatchObject({ key: 'outreach' });
    expect(b.tasks.map((t) => t.title).sort()).toEqual(['Check the replies', 'Nobody has this yet', 'Write the follow-up']);
    expect(b.tasks.find((t) => t.title === 'Write the follow-up')!.assignee_key).toBe('dw-a');
    expect(b.tasks.find((t) => t.title === 'Nobody has this yet')!.assignee_key).toBeNull();
    expect(b.agents.map((a) => a.key)).toEqual(expect.arrayContaining(['dw-a', 'dw-b']));
    expect(b.agents.map((a) => a.key)).not.toContain('dw-c');
    expect(b.tasks[0]!.status).toBe('in_progress'); // what is moving comes first
  });

  it('is a 404 for a department that does not exist or a key that is not one', async () => {
    for (const key of ['nowhere', 'Bad%20Key', '..%2Fx']) expect((await get(`/api/departments/${key}/board`)).status, key).toBe(404);
  });
});

describe('a department channel (S6-13d)', () => {
  it('starts empty, takes a message from the owner, and shows it', async () => {
    expect(((await (await get('/api/departments/outreach/channel')).json()) as Channel).messages).toEqual([]);
    seen.length = 0;
    const r = await post('/api/departments/outreach/channel', { body: '  Please keep replies short.  ' });
    expect(r.status).toBe(201);
    const list = ((await (await get('/api/departments/outreach/channel')).json()) as Channel).messages;
    expect(list).toMatchObject([{ author: 'founder', body: 'Please keep replies short.' }]);
    expect(seen.some((m) => m.kind === 'department.changed')).toBe(true);
  });

  it('keeps each department\'s messages to itself, oldest first', async () => {
    await post('/api/departments/outreach/channel', { body: 'second' });
    await post('/api/departments/research/channel', { body: 'only research' });
    const outreach = ((await (await get('/api/departments/outreach/channel')).json()) as Channel).messages.map((m) => m.body);
    expect(outreach).toEqual(['Please keep replies short.', 'second']);
    expect(((await (await get('/api/departments/research/channel')).json()) as Channel).messages.map((m) => m.body)).toEqual(['only research']);
  });

  it('refuses an empty or very long message and an unknown department, and saves nothing', async () => {
    const n = (await sql('select count(*)::int as n from department_messages')).rows[0].n;
    for (const body of [{ body: '   ' }, { body: 'x'.repeat(2001) }, { body: 5 }, {}]) expect((await post('/api/departments/outreach/channel', body)).status, JSON.stringify(body)).toBe(400);
    expect((await post('/api/departments/nowhere/channel', { body: 'hi' })).status).toBe(404);
    expect((await sql('select count(*)::int as n from department_messages')).rows[0].n).toBe(n);
  });

  it('shows only the latest hundred', async () => {
    for (let i = 0; i < 105; i++) await sql("insert into department_messages (workspace_id, department_id, author, body) values ($1, (select id from departments where key = 'research'), 'founder', $2)", [ws(), `m${i}`]);
    const list = ((await (await get('/api/departments/research/channel')).json()) as Channel).messages;
    expect(list).toHaveLength(100);
    expect(list.at(-1)!.body).toBe('m104');
  });
});

describe('what an agent can do for its department (S6-13d)', () => {
  it('posts to its own department\'s channel, as itself', async () => {
    const t = await task('A task', 'in_progress', 'dw-a');
    await sql('update tasks set locked_by = $2 where id = $1', [t, ids['dw-a']]);
    expect(await callOsTool(store, scope('dw-a', t), 'department_say', { text: 'I am on the follow-ups today.' })).toMatch(/posted/i);
    const list = ((await (await get('/api/departments/outreach/channel')).json()) as Channel).messages;
    expect(list.at(-1)).toMatchObject({ author: 'agent:dw-a', body: 'I am on the follow-ups today.' });
    expect(((await (await get('/api/departments/research/channel')).json()) as Channel).messages.some((m) => m.author === 'agent:dw-a')).toBe(false);
  });

  it('hands its task to a colleague in the same department, with a note they can read', async () => {
    const t = await task('Send the concept', 'in_progress', 'dw-a');
    await sql('update tasks set locked_by = $2 where id = $1', [t, ids['dw-a']]);
    changed.length = 0;
    expect(await callOsTool(store, scope('dw-a', t), 'hand_off_task', { to: 'dw-b', note: 'Over to you for the send.' })).toMatch(/handed/i);
    const row = (await sql('select status, assignee_id, locked_by, session_id from tasks where id = $1', [t])).rows[0];
    expect(row).toMatchObject({ status: 'todo', assignee_id: ids['dw-b'], locked_by: null, session_id: null });
    expect((await sql('select from_id, to_id, body from messages where task_id = $1', [t])).rows).toEqual([{ from_id: 'agent:dw-a', to_id: 'agent:dw-b', body: 'Over to you for the send.' }]);
    expect(changed).toContain(t);
  });

  it('cannot hand a task to someone in another department, to itself, to nobody, or with no note', async () => {
    const t = await task('Stays here', 'in_progress', 'dw-a');
    await sql('update tasks set locked_by = $2 where id = $1', [t, ids['dw-a']]);
    for (const args of [{ to: 'dw-c', note: 'x' }, { to: 'dw-a', note: 'x' }, { to: 'nobody', note: 'x' }, { to: 'dw-b', note: '' }, { to: 'dw-b' }]) {
      await expect(callOsTool(store, scope('dw-a', t), 'hand_off_task', args), JSON.stringify(args)).rejects.toThrow();
    }
    expect((await sql('select assignee_id, status from tasks where id = $1', [t])).rows[0]).toMatchObject({ assignee_id: ids['dw-a'], status: 'in_progress' });
  });

  it('is only for agents above the trial level', async () => {
    await sql('update agents set autonomy = 0 where id = $1', [ids['dw-b']]);
    const t = await task('Trial task', 'in_progress', 'dw-b');
    await sql('update tasks set locked_by = $2 where id = $1', [t, ids['dw-b']]);
    await expect(callOsTool(store, scope('dw-b', t), 'department_say', { text: 'hi' })).rejects.toThrow();
    await expect(callOsTool(store, scope('dw-b', t), 'hand_off_task', { to: 'dw-a', note: 'x' })).rejects.toThrow();
    await sql('update agents set autonomy = 1 where id = $1', [ids['dw-b']]);
  });
});
