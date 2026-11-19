import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore, osTools } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { dueNudges } from '../src/network/network';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** The Founder Network (S8-11b): people worth knowing, a note on each, drafts in your voice that only you send, and nudges when they are due. */
let sys: System;
let app: ReturnType<typeof createApp>;
let store: DbOsStore;
let agentId = '';
let runId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId });
const json = { 'content-type': 'application/json' };
const call = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: json, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'net-r', name: 'Ren' });
  agentId = (await sql("select id from agents where key = 'net-r'")).rows[0].id;
  await sql('update agents set autonomy = 1 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 240_000);
afterAll(() => sys?.close());

describe('people in the network (S8-11b)', () => {
  it('are added by an agent with a note and where they were found, once per person', async () => {
    expect(osTools.add_network_person.minAutonomy).toBe(1);
    expect(await callOsTool(store, scope(), 'add_network_person', { name: 'Priya Rao', whereFound: 'https://example.test/priya', note: 'Founder of a booking tool for clinics in Toronto.' })).toMatch(/Added/);
    expect(await callOsTool(store, scope(), 'add_network_person', { name: 'priya rao', whereFound: 'https://example.test/priya', note: 'Again.' })).toMatch(/Already/);
    const p = (await sql("select name, note, where_found, status from network_people")).rows;
    expect(p).toEqual([{ name: 'Priya Rao', note: 'Founder of a booking tool for clinics in Toronto.', where_found: 'https://example.test/priya', status: 'new' }]);
  });

  it('are listed by the API with their drafts and when the last touch was', async () => {
    const list = ((await (await call('GET', '/api/network')).json()) as { people: { name: string; drafts: unknown[]; lastTouch: string | null; nextNudge: string | null }[] }).people;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Priya Rao', drafts: [], lastTouch: null, nextNudge: null });
  });
});

describe('drafts (S8-11b)', () => {
  let personId = '';
  it('are saved for a person in your voice, and the OS never sends them: there is no way to', async () => {
    personId = (await sql("select id from network_people where name = 'Priya Rao'")).rows[0].id;
    expect(await callOsTool(store, scope(), 'draft_network_message', { personId, text: 'Hi Priya, I build booking pages for clinics too. Would a short call help either of us?' })).toMatch(/Saved as a draft/);
    const d = (await sql('select status, text from network_drafts where person_id = $1', [personId])).rows;
    expect(d).toEqual([{ status: 'draft', text: expect.stringMatching(/booking pages for clinics/) }]);
    expect((await sql("select count(*)::int as n from approvals where kind in ('email.send','dm.send','post.publish')")).rows[0].n).toBe(0);
    expect(Object.keys(osTools).filter((k) => /send_network|network_send/.test(k))).toEqual([]);
  });

  it('refuse a person who is not there, and text that makes a blocked claim', async () => {
    await expect(callOsTool(store, scope(), 'draft_network_message', { personId: randomUUID(), text: 'Hello' })).rejects.toThrow(/No such person/);
    await expect(callOsTool(store, scope(), 'draft_network_message', { personId, text: 'We guarantee to cure your back pain.' })).rejects.toThrow(/Refused/);
  });

  it('become a touch only when you say you sent it yourself, which also sets the next nudge', async () => {
    const id = (await sql('select id from network_drafts where person_id = $1', [personId])).rows[0].id as string;
    expect((await call('POST', `/api/network/drafts/${id}/sent`, { nudgeInDays: 14 })).status).toBe(200);
    const p = (await sql('select status, last_touch, next_nudge from network_people where id = $1', [personId])).rows[0];
    expect(p.status).toBe('in_touch');
    expect(p.last_touch).not.toBeNull();
    expect(p.next_nudge).not.toBeNull();
    expect((await sql('select status from network_drafts where id = $1', [id])).rows[0].status).toBe('sent_by_you');
    expect((await call('POST', `/api/network/drafts/${id}/sent`, {})).status).toBe(409); // not twice
    expect((await call('POST', `/api/network/drafts/${randomUUID()}/sent`, {})).status).toBe(404);
    expect((await call('POST', `/api/network/drafts/${id}/sent`, { nudgeInDays: 9999 })).status).toBe(400);
  });
});

describe('nudges (S8-11b)', () => {
  it('are due when their day has come, and only for people still in touch', async () => {
    const id = (await sql("insert into network_people (workspace_id, name, name_key, where_found, note, status, next_nudge) values ($1, 'Sam Lee', 'sam lee', 'a post', 'A founder in Austin.', 'in_touch', '2026-12-01') returning id", [ws()])).rows[0].id as string;
    await sql("insert into network_people (workspace_id, name, name_key, where_found, note, status, next_nudge) values ($1, 'Done Dan', 'done dan', 'a post', 'Moved on.', 'dropped', '2026-11-01')", [ws()]);
    expect((await dueNudges(sys.app, ws(), '2026-11-30')).map((p) => p.name)).toEqual([]);
    expect((await dueNudges(sys.app, ws(), '2026-12-01')).map((p) => p.id)).toEqual([id]);
    expect((await dueNudges(sys.app, ws(), '2027-01-01')).map((p) => p.name)).toEqual(expect.arrayContaining(['Sam Lee']));
    expect((await dueNudges(sys.app, ws(), '2027-01-01')).map((p) => p.name)).not.toContain('Done Dan');
  });
});
