import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
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
const ids: Record<string, string> = {};
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
type Card = { id: string; key: string; name: string; department: string | null; state: string; since: string | null; task: string | null; forYou: number };
const team = async () => ((await (await app.request('/api/office/team')).json()) as { team: Card[] }).team;
const card = async (key: string) => (await team()).find((c) => c.key === key)!;

beforeAll(async () => {
  ({ sys } = await testSystem());
  await rm(path.join(sys.companyRoot, 'departments'), { recursive: true, force: true });
  for (const [k, d] of [['tm-work', 'outreach'], ['tm-wait', 'outreach'], ['tm-block', 'research'], ['tm-idle', 'research']] as const) {
    await agentNew(sys, { template: 'researcher', department: d, id: k });
    ids[k] = (await sql('select id from agents where key = $1', [k])).rows[0].id;
  }
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot });
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from approvals');
  await sql('delete from run_events');
  await sql('delete from runs');
  await sql('delete from tasks');
});
const task = async (title: string, status: string, agent: string) => (await sql('insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, $2, $3, $4, $5) returning id', [ws(), title, status, ids[agent], 'founder'])).rows[0].id as string;
const run = (agent: string, status: string, taskId: string | null = null, startedAgo = 90) =>
  sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status, started_at) values ($1, $2, $3, 'manual', 'claude-cli', $4, now() - make_interval(secs => $5))", [ws(), ids[agent], taskId, status, startedAgo]);
const approval = (agent: string, status = 'pending') => sql("insert into approvals (workspace_id, kind, dedupe_key, agent_id, payload, status) values ($1, 'email.send', $2, $3, '{}', $4)", [ws(), `k-${Math.random()}`, ids[agent], status]);

describe('a card for each agent (S6-14b2)', () => {
  it('has one card for each active agent, with its name and department, and nothing else to start with', async () => {
    const c = await card('tm-idle');
    expect(c).toMatchObject({ name: expect.any(String), department: 'research', state: 'idle', task: null, forYou: 0 });
    expect(c.since).toBeNull();
    await sql("update agents set status = 'retired' where id = $1", [ids['tm-idle']]);
    expect((await team()).some((x) => x.key === 'tm-idle')).toBe(false);
    await sql("update agents set status = 'active' where id = $1", [ids['tm-idle']]);
  });

  it('shows what it is working on, and since when', async () => {
    const t = await task('Write the follow-up', 'in_progress', 'tm-work');
    await run('tm-work', 'running', t, 90);
    const c = await card('tm-work');
    expect(c).toMatchObject({ state: 'working', task: 'Write the follow-up' });
    const secs = (Date.now() - new Date(c.since!).getTime()) / 1000;
    expect(secs).toBeGreaterThan(80);
    expect(secs).toBeLessThan(180);
  });

  it('counts what is waiting for you from this agent, and says it is waiting', async () => {
    await approval('tm-wait');
    await approval('tm-wait');
    await approval('tm-wait', 'approved');
    await approval('tm-work');
    const c = await card('tm-wait');
    expect(c).toMatchObject({ state: 'waiting', forYou: 2 });
    expect((await card('tm-work')).forYou).toBe(1);
    expect((await card('tm-idle')).forYou).toBe(0);
  });

  it('says an idle agent with a blocked task is blocked, and what the task is', async () => {
    await task('Needs a price', 'blocked', 'tm-block');
    expect(await card('tm-block')).toMatchObject({ state: 'blocked', task: 'Needs a price' });
  });

  it('puts working above waiting above blocked above idle when more than one is true', async () => {
    const t = await task('Busy', 'in_progress', 'tm-wait');
    await task('Stuck', 'blocked', 'tm-wait');
    await run('tm-wait', 'running', t);
    await approval('tm-wait');
    expect((await card('tm-wait')).state).toBe('working');
    await sql("update runs set status = 'succeeded'");
    expect((await card('tm-wait')).state).toBe('waiting');
    await sql("update approvals set status = 'approved'");
    expect((await card('tm-wait')).state).toBe('blocked');
  });

  it('does not count finished tasks as the task it is on', async () => {
    await task('Done already', 'done', 'tm-idle');
    expect(await card('tm-idle')).toMatchObject({ state: 'idle', task: null });
  });
});
