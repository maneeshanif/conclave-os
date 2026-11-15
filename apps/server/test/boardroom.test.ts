import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import { checkEvidence } from '../src/boardroom/evidence';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore, osTools } from '../src/harness/os-tools';
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
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = (agent: string) => ({ workspaceId: ws(), agentId: ids[agent]!, runId: '00000000-0000-4000-8000-000000000000', taskId: undefined as never });
const tool = (agent: string, name: string, args: unknown) => callOsTool(store, scope(agent), name, args);
const call = (method: string, url: string, body?: unknown) => app.request(url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
const count = (table: string, status: string, claimed: number) => ({ type: 'count', table, where: { column: 'status', value: status }, claimed });
const discussion = async (question = 'Where should we focus?', participants: string[] = []) => {
  const r = await call('POST', '/api/discussions', { kind: 'adhoc', question, participants });
  return ((await r.json()) as { id: string }).id;
};
const makeTasks = async (n: number, status: string) => {
  for (let i = 0; i < n; i++) await sql("insert into tasks (workspace_id, title, status, created_by) values ($1, $2, $3, 'founder')", [ws(), `bt-${status}-${i}`, status]);
};
const real = async (table: string, status: string) => (await sql(`select count(*)::int as n from ${table} where status = $1`, [status])).rows[0].n as number;

beforeAll(async () => {
  ({ sys } = await testSystem());
  await rm(path.join(sys.companyRoot, 'departments'), { recursive: true, force: true });
  for (const [k, d] of [['bd-lead', 'lead-gen'], ['bd-out', 'outreach'], ['bd-res', 'research']] as const) {
    await agentNew(sys, { template: 'researcher', department: d, id: k });
    ids[k] = (await sql('select id from agents where key = $1', [k])).rows[0].id;
  }
  for (const k of ['bd-lead', 'bd-out']) await sql('update agents set autonomy = 1 where id = $1', [ids[k]]); // after all are made: creating one resets the rest
  const bus = new Bus();
  bus.subscribe((m) => seen.push(m));
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot });
}, 240_000);
afterAll(async () => sys?.close());

describe('evidence the OS checks against its own tables (S6-10)', () => {
  it('accepts a count that is true, with or without a filter', async () => {
    await makeTasks(3, 'todo');
    const todo = await real('tasks', 'todo');
    const agents = (await sql('select count(*)::int as n from agents')).rows[0].n as number;
    const r = await withWorkspace(sys.app, ws(), ({ client }) => checkEvidence(client, [count('tasks', 'todo', todo), { type: 'count', table: 'agents', claimed: agents }]));
    expect(r).toEqual({ ok: true });
  });

  it('refuses a count that is wrong, and says what the table shows', async () => {
    const todo = await real('tasks', 'todo');
    const r = await withWorkspace(sys.app, ws(), ({ client }) => checkEvidence(client, [count('tasks', 'todo', todo + 5)]));
    expect(r.ok).toBe(false);
    expect((r as { reasons: string[] }).reasons[0]).toMatch(new RegExp(`tasks.*status.*todo.*${todo}.*not ${todo + 5}`));
  });

  it('accepts a record that exists and refuses one that does not, or that belongs to another company', async () => {
    const t = (await sql("select id from tasks limit 1")).rows[0].id;
    const ok = await withWorkspace(sys.app, ws(), ({ client }) => checkEvidence(client, [{ type: 'record', table: 'tasks', id: t }]));
    expect(ok).toEqual({ ok: true });
    const missing = await withWorkspace(sys.app, ws(), ({ client }) => checkEvidence(client, [{ type: 'record', table: 'tasks', id: '11111111-1111-4111-8111-111111111111' }]));
    expect(missing.ok).toBe(false);
  });

  it('only checks tables and columns on its list, and nothing else gets near the database', async () => {
    for (const item of [{ type: 'count', table: 'users', claimed: 1 }, { type: 'count', table: 'tasks', where: { column: 'title; drop table tasks', value: 'x' }, claimed: 1 }, { type: 'count', table: 'tasks', where: { column: 'title', value: 'x' }, claimed: 1 }, { type: 'bogus' }]) {
      const r = await withWorkspace(sys.app, ws(), ({ client }) => checkEvidence(client, [item]));
      expect(r.ok, JSON.stringify(item)).toBe(false);
    }
    expect((await sql('select count(*)::int as n from tasks')).rows[0].n).toBeGreaterThan(0); // still there
  });
});

describe('the tools an agent uses in a discussion (S6-10)', () => {
  it('opens a discussion, and lists who it is for', async () => {
    const out = await tool('bd-lead', 'open_discussion', { kind: 'adhoc', question: 'Should we pause cold email?', participants: ['bd-out'] });
    expect(out).toMatch(/opened/i);
    const row = (await sql("select kind, question, status, opened_by, participants from discussions where question = 'Should we pause cold email?'")).rows[0];
    expect(row).toMatchObject({ kind: 'adhoc', status: 'open', opened_by: 'agent:bd-lead', participants: ['bd-out'] });
  });

  it('refuses a participant that is not an agent of the company, and an unknown kind', async () => {
    await expect(tool('bd-lead', 'open_discussion', { kind: 'adhoc', question: 'Q', participants: ['nobody'] })).rejects.toThrow(/nobody/);
    await expect(tool('bd-lead', 'open_discussion', { kind: 'party', question: 'Q' })).rejects.toThrow();
  });

  it('refuses a turn that cites nothing, and one whose figure the tables do not show', async () => {
    const id = await discussion();
    await expect(tool('bd-lead', 'add_turn', { discussionId: id, round: 1, body: 'We are doing great.', evidence: [] })).rejects.toThrow(/evidence/i);
    await expect(tool('bd-lead', 'add_turn', { discussionId: id, round: 1, body: 'We have 900 todo tasks.', evidence: [count('tasks', 'todo', 900)] })).rejects.toThrow(/not 900/);
    expect((await sql('select 1 from discussion_turns where discussion_id = $1', [id])).rows).toHaveLength(0);
  });

  it('accepts a turn that cites a real count, and keeps what was cited', async () => {
    const id = await discussion();
    const todo = await real('tasks', 'todo');
    expect(await tool('bd-lead', 'add_turn', { discussionId: id, round: 1, body: `There are ${todo} tasks still to do.`, evidence: [count('tasks', 'todo', todo)] })).toMatch(/added/i);
    const t = (await sql('select speaker, round, body, evidence from discussion_turns where discussion_id = $1', [id])).rows[0];
    expect(t).toMatchObject({ speaker: 'bd-lead', round: 1 });
    expect(t.evidence).toEqual([count('tasks', 'todo', todo)]);
  });

  it('allows one turn from each speaker in each round, up to three rounds', async () => {
    const id = await discussion();
    const todo = await real('tasks', 'todo');
    const turn = (agent: string, round: number) => tool(agent, 'add_turn', { discussionId: id, round, body: 'Counting.', evidence: [count('tasks', 'todo', todo)] });
    await turn('bd-lead', 1);
    await expect(turn('bd-lead', 1)).rejects.toThrow(/already/i);
    await turn('bd-out', 1);
    await turn('bd-lead', 2);
    await turn('bd-lead', 3);
    await expect(tool('bd-lead', 'add_turn', { discussionId: id, round: 4, body: 'x', evidence: [count('tasks', 'todo', todo)] })).rejects.toThrow();
  });

  it('keeps a discussion for the agents it is for, and stops turns once it is closed', async () => {
    const todo = await real('tasks', 'todo');
    const forOut = await discussion('Only outreach', ['bd-out']);
    const args = (id: string) => ({ discussionId: id, round: 1, body: 'Hi.', evidence: [count('tasks', 'todo', todo)] });
    await expect(tool('bd-lead', 'add_turn', args(forOut))).rejects.toThrow(/not one of the agents/i);
    await tool('bd-out', 'add_turn', args(forOut));
    await call('POST', `/api/discussions/${forOut}/close`, {});
    const closed = await discussion('Closed soon');
    await call('POST', `/api/discussions/${closed}/close`, {});
    await expect(tool('bd-lead', 'add_turn', args(closed))).rejects.toThrow(/closed/i);
    await expect(tool('bd-lead', 'add_turn', { ...args(await discussion()), discussionId: '11111111-1111-4111-8111-111111111111' })).rejects.toThrow();
  });

  it('needs a summary turn to say where the leads disagree (or that they do not)', async () => {
    const id = await discussion();
    const todo = await real('tasks', 'todo');
    const base = { discussionId: id, round: 1, body: 'Options: pause, or carry on.', evidence: [count('tasks', 'todo', todo)], summary: true };
    await expect(tool('bd-lead', 'add_turn', base)).rejects.toThrow(/disagree/i);
    await tool('bd-lead', 'add_turn', { ...base, disagreements: 'Outreach wants to carry on; Lead Gen wants to pause.' });
    expect((await sql('select disagreements from discussion_turns where discussion_id = $1', [id])).rows[0].disagreements).toMatch(/Outreach wants/);
  });

  it('is only for agents above the trial level, except reading the decision log', async () => {
    await expect(tool('bd-res', 'open_discussion', { kind: 'adhoc', question: 'Q' })).rejects.toThrow();
    await expect(tool('bd-res', 'add_turn', { discussionId: await discussion(), round: 1, body: 'x', evidence: [count('tasks', 'todo', 1)] })).rejects.toThrow();
    await expect(tool('bd-res', 'get_decisions', {})).resolves.toBeDefined();
  });

  it('has no tool that records a decision: only a person does', () => {
    expect(Object.keys(osTools).filter((n) => /decision|decide/.test(n))).toEqual(['get_decisions']);
  });
});

describe('the Boardroom API (S6-10)', () => {
  it('lists discussions with their turns, and closes one', async () => {
    const id = await discussion('Weekly numbers?');
    const todo = await real('tasks', 'todo');
    await tool('bd-lead', 'add_turn', { discussionId: id, round: 1, body: 'A turn.', evidence: [count('tasks', 'todo', todo)] });
    const list = (await (await call('GET', '/api/discussions')).json()) as { discussions: { id: string; question: string; status: string; turns: number }[] };
    expect(list.discussions.find((d) => d.id === id)).toMatchObject({ question: 'Weekly numbers?', status: 'open', turns: 1 });
    const one = (await (await call('GET', `/api/discussions/${id}`)).json()) as { discussion: { id: string }; turns: { speaker: string; evidence: unknown[] }[] };
    expect(one.turns).toHaveLength(1);
    expect(one.turns[0]).toMatchObject({ speaker: 'bd-lead' });
    expect(one.turns[0]!.evidence).toHaveLength(1);
    expect((await call('POST', `/api/discussions/${id}/close`, {})).status).toBe(200);
    expect(((await (await call('GET', `/api/discussions/${id}`)).json()) as { discussion: { status: string } }).discussion.status).toBe('closed');
  });

  it('opens a discussion for you, refuses a bad one, and a missing one is a 404', async () => {
    seen.length = 0;
    const r = await call('POST', '/api/discussions', { kind: 'weekly', question: 'Weekly review', participants: ['bd-lead', 'bd-out'] });
    expect(r.status).toBe(201);
    expect(seen.some((m) => m.kind === 'discussion.changed')).toBe(true);
    for (const body of [{}, { kind: 'adhoc', question: '' }, { kind: 'party', question: 'x' }, { kind: 'adhoc', question: 'x'.repeat(2001) }, { kind: 'adhoc', question: 'x', participants: ['nobody'] }]) {
      expect((await call('POST', '/api/discussions', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call('GET', '/api/discussions/11111111-1111-4111-8111-111111111111')).status).toBe(404);
  });

  it('records a decision made by you, newest first, and an agent can read it', async () => {
    const d = await discussion('Pause cold email?');
    const r1 = await call('POST', '/api/decisions', { title: 'Keep sending', decision: 'Carry on with the three-step sequence.', owner: 'Outreach', due: '2026-12-01', discussionId: d });
    expect(r1.status).toBe(201);
    await new Promise((r) => setTimeout(r, 15));
    await call('POST', '/api/decisions', { title: 'No weekend sends', decision: 'Nothing goes out on Saturday or Sunday.' });
    const log = ((await (await call('GET', '/api/decisions')).json()) as { decisions: { title: string; owner: string | null; due: string | null; decided_by: string }[] }).decisions;
    expect(log.map((x) => x.title)).toEqual(['No weekend sends', 'Keep sending']);
    expect(log[1]).toMatchObject({ owner: 'Outreach', due: '2026-12-01', decided_by: 'founder' });
    const seenByAgent = await tool('bd-res', 'get_decisions', {}).catch(() => '');
    expect(seenByAgent).toContain('No weekend sends');
    expect(seenByAgent).toContain('Keep sending');
  });

  it('refuses a decision with no title or text, a bad date, or a discussion that is not there', async () => {
    const n = (await sql('select count(*)::int as n from decisions')).rows[0].n;
    for (const body of [{}, { title: '', decision: 'x' }, { title: 'x', decision: '' }, { title: 'x', decision: 'y', due: 'soon' }, { title: 'x', decision: 'y', discussionId: '11111111-1111-4111-8111-111111111111' }, { title: 'x', decision: 'y', discussionId: 'nope' }]) {
      expect((await call('POST', '/api/decisions', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await sql('select count(*)::int as n from decisions')).rows[0].n).toBe(n);
  });
});

describe('agents in a discussion are in the Boardroom (S6-10)', () => {
  it('puts the agents an open discussion is for in the Boardroom, and back when it closes', async () => {
    await sql('delete from runs');
    await sql('delete from approvals');
    await sql("update discussions set status = 'closed'"); // the discussions earlier tests left open
    const id = await discussion('Who is in?', ['bd-out']);
    const place = async (key: string) => ((await (await call('GET', '/api/office/state')).json()) as { places: { key: string; place: string }[] }).places.find((p) => p.key === key)!.place;
    expect(await place('bd-out')).toBe('boardroom');
    expect(await place('bd-res')).not.toBe('boardroom');
    await call('POST', `/api/discussions/${id}/close`, {});
    expect(await place('bd-out')).not.toBe('boardroom');
  });
});
