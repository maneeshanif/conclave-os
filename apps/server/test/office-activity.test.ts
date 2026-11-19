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
type Event = { id: string; at: string; kind: string; text: string };
const feed = async () => ((await (await app.request('/api/office/activity')).json()) as { events: Event[] }).events;
const ago = (s: number) => `now() - make_interval(secs => ${s})`;

beforeAll(async () => {
  ({ sys } = await testSystem());
  await rm(path.join(sys.companyRoot, 'departments'), { recursive: true, force: true });
  for (const [k, d] of [['av-a', 'outreach'], ['av-b', 'outreach']] as const) {
    await agentNew(sys, { template: 'researcher', department: d, id: k });
    ids[k] = (await sql('select id from agents where key = $1', [k])).rows[0].id;
  }
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot });
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  for (const t of ['approvals', 'run_events', 'runs', 'messages', 'department_messages']) await sql(`delete from ${t}`);
});
const name = async (k: string) => (await sql('select name from agents where key = $1', [k])).rows[0].name as string;

describe('what just happened (S6-14b3)', () => {
  it('is empty when nothing has happened', async () => {
    expect(await feed()).toEqual([]);
  });

  it('says in plain words that a run started and ended, newest first', async () => {
    await sql(`insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at, ended_at) values ($1, $2, 'manual', 'claude-cli', 'succeeded', ${ago(120)}, ${ago(60)})`, [ws(), ids['av-a']]);
    const e = await feed();
    expect(e.map((x) => x.kind)).toEqual(['run.ended', 'run.started']);
    expect(e[0]!.text).toBe(`${await name('av-a')} finished a run.`);
    expect(e[1]!.text).toBe(`${await name('av-a')} started a run.`);
  });

  it('says when a run failed', async () => {
    await sql(`insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at, ended_at) values ($1, $2, 'manual', 'claude-cli', 'failed', ${ago(50)}, ${ago(40)})`, [ws(), ids['av-a']]);
    expect((await feed())[0]!.text).toMatch(/run did not finish.*failed/i);
  });

  it('says that something was asked of you, and what you decided', async () => {
    await sql(`insert into approvals (workspace_id, kind, dedupe_key, agent_id, payload, status, created_at, decided_at) values ($1, 'email.send', 'k1', $2, '{}', 'approved', ${ago(30)}, ${ago(10)}), ($1, 'post.publish', 'k2', $2, '{}', 'rejected', ${ago(25)}, ${ago(5)}), ($1, 'dm.send', 'k3', $2, '{}', 'pending', ${ago(2)}, null)`, [ws(), ids['av-a']]);
    const text = (await feed()).map((x) => x.text);
    expect(text).toContain(`${await name('av-a')} asked you to approve an email.`);
    expect(text).toContain('You approved an email.');
    expect(text).toContain('You rejected a post.');
    expect(text).toContain(`${await name('av-a')} asked you to approve a direct message.`);
    expect(text.filter((t) => /^You /.test(t))).toHaveLength(2); // the pending one has no decision yet
  });

  it('says that an agent was proposed and added', async () => {
    await sql(`insert into approvals (workspace_id, kind, dedupe_key, payload, status, created_at, decided_at) values ($1, 'agent.create', 'agent:x', $2, 'executed', ${ago(20)}, ${ago(10)})`, [ws(), JSON.stringify({ department: 'outreach', template: 'researcher', name: 'Scribe', id: 'outreach-researcher' })]);
    const text = (await feed()).map((x) => x.text);
    expect(text).toContain('You proposed adding Scribe to outreach.');
    expect(text).toContain('You approved adding an agent.');
  });

  it('says that a task was handed to a colleague, but not a note to the founder', async () => {
    await sql(`insert into messages (workspace_id, from_id, to_id, body, created_at) values ($1, 'agent:av-a', 'agent:av-b', 'over to you', ${ago(8)}), ($1, 'agent:av-a', 'founder', 'a question', ${ago(7)}), ($1, 'agent:av-a', null, 'a note', ${ago(6)})`, [ws()]);
    const e = await feed();
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: 'task.handoff', text: `${await name('av-a')} handed a task to ${await name('av-b')}.` });
  });

  it('shows a department channel message, with who said it and where, cut short', async () => {
    await sql(`insert into department_messages (workspace_id, department_id, author, body, created_at) values ($1, (select id from departments where key = 'outreach'), 'agent:av-a', $2, ${ago(3)}), ($1, (select id from departments where key = 'outreach'), 'founder', 'Thanks all', ${ago(1)})`, [ws(), 'x'.repeat(200)]);
    const e = await feed();
    expect(e[0]!.text).toBe('You said in Outreach: Thanks all');
    expect(e[1]!.text.startsWith(`${await name('av-a')} said in Outreach: xxx`)).toBe(true);
    expect(e[1]!.text.length).toBeLessThan(130);
  });

  it('keeps the latest twenty, newest first, each event once', async () => {
    for (let i = 0; i < 30; i++) await sql(`insert into department_messages (workspace_id, department_id, author, body, created_at) values ($1, (select id from departments where key = 'outreach'), 'founder', $2, ${ago(100 - i)})`, [ws(), `m${i}`]);
    const e = await feed();
    expect(e).toHaveLength(20);
    expect(e[0]!.text).toContain('m29');
    expect(new Set(e.map((x) => x.id)).size).toBe(20);
    expect([...e].map((x) => x.at)).toEqual([...e].map((x) => x.at).sort().reverse());
  });
});
