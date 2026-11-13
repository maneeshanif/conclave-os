import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';
import { rm } from 'node:fs/promises';
import path from 'node:path';

let sys: System;
let app: ReturnType<typeof createApp>;
let agent = '';
let other = '';
const requested: { agentId: string; trigger: string }[] = [];
const seen: BusMessage[] = [];
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const post = (url: string, body: unknown) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
type Drawer = { agent: { id: string; key: string; name: string; department: string | null }; run: { id: string; status: string } | null; tasks: { id: string; title: string; status: string }[] };
const drawer = async (id = agent) => (await (await app.request(`/api/office/agents/${id}`)).json()) as Drawer;

beforeAll(async () => {
  ({ sys } = await testSystem());
  const bus = new Bus();
  bus.subscribe((m) => seen.push(m));
  const dispatcher = new LocalDispatcher(async () => ({ status: 'no_task' }));
  const request = dispatcher.request.bind(dispatcher);
  dispatcher.request = async (r) => {
    requested.push({ agentId: r.agentId, trigger: r.trigger });
    return request(r);
  };
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher, companyRoot: sys.companyRoot });
  await rm(path.join(sys.companyRoot, 'departments'), { recursive: true, force: true });
  await agentNew(sys, { template: 'researcher', department: 'outreach', id: 'dr-one' });
  await agentNew(sys, { template: 'researcher', department: 'outreach', id: 'dr-two' });
  agent = (await sql('select id from agents where key = $1', ['dr-one'])).rows[0].id;
  other = (await sql('select id from agents where key = $1', ['dr-two'])).rows[0].id;
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from run_events');
  await sql('delete from runs');
  await sql('delete from tasks');
  requested.length = 0;
  seen.length = 0;
});

describe('the agent drawer (S6-6)', () => {
  it('shows who the agent is, with no run and no tasks to begin with', async () => {
    const d = await drawer();
    expect(d.agent).toMatchObject({ id: agent, key: 'dr-one', department: 'outreach' });
    expect(d.run).toBeNull();
    expect(d.tasks).toEqual([]);
  });

  it('shows the run going now, and only open tasks that belong to this agent', async () => {
    await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at) values ($1, $2, 'manual', 'claude-cli', 'running', now())", [ws(), agent]);
    await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at) values ($1, $2, 'manual', 'claude-cli', 'succeeded', now() - interval '1 hour')", [ws(), agent]);
    await sql("insert into tasks (workspace_id, title, assignee_id, status, created_by) values ($1, 'open one', $2, 'todo', 'founder'), ($1, 'finished', $2, 'done', 'founder'), ($1, 'someone else', $3, 'todo', 'founder')", [ws(), agent, other]);
    const d = await drawer();
    expect(d.run).toMatchObject({ status: 'running' });
    expect(d.tasks.map((t) => t.title)).toEqual(['open one']);
  });

  it('is a 404 for an agent that does not exist', async () => {
    expect((await app.request('/api/office/agents/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

describe('a message from the drawer (S6-6)', () => {
  it('creates one task assigned to that agent, and asks for a run', async () => {
    const r = await post(`/api/office/agents/${agent}/message`, { text: 'Find five more leads in dental clinics.\nPrefer ones with a booking page.' });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    const rows = (await sql('select title, body, assignee_id, created_by, status from tasks')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Find five more leads in dental clinics.', assignee_id: agent, created_by: 'founder', status: 'todo' });
    expect(rows[0].body).toContain('Prefer ones with a booking page.');
    expect((await drawer()).tasks.map((t) => t.id)).toEqual([id]);
    expect(seen.some((m) => m.kind === 'task.changed')).toBe(true);
    expect(requested).toEqual([{ agentId: agent, trigger: 'task_assigned' }]);
  });

  it('turns away an empty message, and one for an agent that does not exist', async () => {
    expect((await post(`/api/office/agents/${agent}/message`, { text: '   ' })).status).toBe(400);
    expect((await post('/api/office/agents/00000000-0000-4000-8000-000000000000/message', { text: 'hello' })).status).toBe(404);
    expect((await sql('select 1 from tasks')).rows).toHaveLength(0);
  });
});
