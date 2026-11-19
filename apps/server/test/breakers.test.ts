import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { Breakers } from '../src/harness/breakers';
import { MemoryOsStore, ToolError, type TaskView } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { withWorkspace } from '../src/db/tenant';
import { mcpRoutes } from '../src/routes/mcp';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
let clock = new Date('2026-11-13T12:00:00Z');
const breakers = () => new Breakers({ pool: sys.app, workspaceId: ws(), now: () => clock, cooldownMs: 5 * 60_000 });
const items = async () => (await sql("select status, title, body from action_items where kind = 'breaker_open' order by created_at")).rows;

beforeAll(async () => {
  ({ sys } = await testSystem());
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  clock = new Date('2026-11-13T12:00:00Z');
  await sql('delete from circuit_breakers');
  await sql("delete from action_items where kind = 'breaker_open'");
});

describe('a circuit breaker (S3-6)', () => {
  it('lets calls through until three failures in a row, then refuses with a clear message', async () => {
    const b = breakers();
    for (let i = 0; i < 2; i++) {
      expect((await b.before('os:add_lead')).allowed).toBe(true);
      await b.failure('os:add_lead', 'db down');
    }
    expect((await b.before('os:add_lead')).allowed).toBe(true); // two failures: still closed
    await b.failure('os:add_lead', 'db down');
    const gate = await b.before('os:add_lead');
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.until).toEqual(new Date(clock.getTime() + 5 * 60_000));
  });

  it('a success in between starts the count again', async () => {
    const b = breakers();
    await b.failure('os:add_lead', 'x');
    await b.failure('os:add_lead', 'x');
    await b.success('os:add_lead');
    await b.failure('os:add_lead', 'x');
    await b.failure('os:add_lead', 'x');
    expect((await b.before('os:add_lead')).allowed).toBe(true);
  });

  it('does not count a call it refused, so waiting out the cooldown is what closes it', async () => {
    const b = breakers();
    for (let i = 0; i < 3; i++) await b.failure('os:add_lead', 'x');
    for (let i = 0; i < 10; i++) expect((await b.before('os:add_lead')).allowed).toBe(false);
    clock = new Date(clock.getTime() + 4 * 60_000);
    expect((await b.before('os:add_lead')).allowed).toBe(false); // not yet
    clock = new Date(clock.getTime() + 2 * 60_000);
    expect((await b.before('os:add_lead')).allowed).toBe(true); // the cooldown is over
    // And it needs three fresh failures to open again.
    await b.failure('os:add_lead', 'x');
    await b.failure('os:add_lead', 'x');
    expect((await b.before('os:add_lead')).allowed).toBe(true);
  });

  it('keeps each tool apart: one open breaker does not stop another tool', async () => {
    const b = breakers();
    for (let i = 0; i < 3; i++) await b.failure('os:add_lead', 'x');
    expect((await b.before('os:add_lead')).allowed).toBe(false);
    expect((await b.before('os:score_lead')).allowed).toBe(true);
  });

  it('raises one action item when it opens, names the tool and the last error, and closes it when it closes', async () => {
    const b = breakers();
    for (let i = 0; i < 5; i++) await b.failure('os:add_lead', 'connection refused'); // failures after it opens do not make more items
    const its = await items();
    expect(its).toHaveLength(1);
    expect(its[0]!.title).toMatch(/add_lead/);
    expect(its[0]!.body).toMatch(/connection refused/);
    clock = new Date(clock.getTime() + 6 * 60_000);
    await b.before('os:add_lead'); // cooldown over: closes
    expect((await items())[0]!.status).toBe('done');
  });

  it('can be reset by a person, which closes the item; resetting a closed one is a no-op', async () => {
    const b = breakers();
    for (let i = 0; i < 3; i++) await b.failure('os:add_lead', 'x');
    expect(await b.reset('os:add_lead', 'founder')).toBe(true);
    expect((await b.before('os:add_lead')).allowed).toBe(true);
    expect((await items())[0]!.status).toBe('done');
    expect(await b.reset('os:add_lead', 'founder')).toBe(false);
  });

  it('lists the breakers that are open', async () => {
    const b = breakers();
    for (let i = 0; i < 3; i++) await b.failure('os:add_lead', 'boom');
    await b.failure('os:score_lead', 'one failure only');
    const open = await b.list();
    expect(open.filter((x) => x.state === 'open').map((x) => x.key)).toEqual(['os:add_lead']);
    expect(open.find((x) => x.key === 'os:score_lead')).toMatchObject({ state: 'closed', failures: 1 });
  });
});

describe('on the os tool calls (S3-6)', () => {
  /** A store whose reads break, and which counts how often it is asked. */
  class Flaky extends MemoryOsStore {
    calls = 0;
    breakIt = true;
    override async getTask(): Promise<TaskView | null> {
      this.calls++;
      if (this.breakIt) throw new Error('database is down');
      return { id: 't', title: 'T', body: null, status: 'in_progress', comments: [] };
    }
    override async completeTask(): Promise<void> {
      throw new ToolError('The task is not in progress.');
    }
  }
  const setup = () => {
    const store = new Flaky();
    const tokens = new RunTokens();
    const token = tokens.issue({ workspaceId: ws(), agentId: 'a', runId: 'r', taskId: 't' }, 60_000);
    const app = mcpRoutes({ tokens, store, breakers: breakers() });
    const call = async (name: string, args: unknown = {}) => {
      const res = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      return (await res.json()) as { result?: { isError?: boolean; content: { text: string }[] }; error?: { message: string } };
    };
    return { store, call };
  };

  it('opens after three real failures, then refuses at once without asking the store, and says why', async () => {
    const { store, call } = setup();
    for (let i = 0; i < 3; i++) expect((await call('get_task')).error?.message).toMatch(/internal error/i);
    expect(store.calls).toBe(3);
    const refused = await call('get_task');
    expect(refused.result?.isError).toBe(true);
    expect(refused.result?.content[0]!.text).toMatch(/temporarily unavailable/i);
    expect(store.calls).toBe(3); // not asked
  });

  it('does not count a refusal like "not in progress" as a failure: the tool worked', async () => {
    const { call } = setup();
    for (let i = 0; i < 6; i++) expect((await call('complete_task', { output: 'x' })).result?.isError).toBe(true);
    const state = (await sql("select state from circuit_breakers where key = 'os:complete_task'")).rows[0];
    expect(state?.state ?? 'closed').toBe('closed');
  });

  it('recovers when the cooldown is over and a call works', async () => {
    const { store, call } = setup();
    for (let i = 0; i < 3; i++) await call('get_task');
    store.breakIt = false;
    clock = new Date(clock.getTime() + 6 * 60_000);
    expect((await call('get_task')).result?.isError).toBeUndefined();
  });

  it('makes no breaker for a tool that does not exist', async () => {
    const { call } = setup();
    await call('send_email', {});
    expect((await sql("select count(*)::int as n from circuit_breakers where key like '%send_email'")).rows[0].n).toBe(0);
  });
});

describe('the breaker API (S3-6)', () => {
  const app = () => createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), breakers: breakers(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
  const json = { 'content-type': 'application/json' };

  it('lists open breakers and resets one on request', async () => {
    const b = breakers();
    for (let i = 0; i < 3; i++) await b.failure('os:add_lead', 'boom');
    const a = app();
    const list = (await (await a.request('/api/breakers')).json()) as { key: string; state: string }[];
    expect(list.map((x) => x.key)).toContain('os:add_lead');
    expect((await a.request('/api/breakers/os:add_lead/reset', { method: 'POST', headers: json, body: '{}' })).status).toBe(200);
    expect((await a.request('/api/breakers/os:add_lead/reset', { method: 'POST', headers: json, body: '{}' })).status).toBe(404);
    expect((await b.before('os:add_lead')).allowed).toBe(true);
  });
});
