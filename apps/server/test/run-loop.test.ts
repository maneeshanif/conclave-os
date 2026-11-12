import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { checkoutTask, executeRun, type LoopDeps } from '../src/harness/loop';
import type { OsStore, ProposedEmail } from '../src/harness/os-tools';
import { RunTokens, type RunScope } from '../src/harness/run-tokens';
import { mcpRoutes } from '../src/routes/mcp';
import { createCliRuntime } from '../src/runtimes/cli';
import type { RunEvent, RunRequest, Runtime } from '../src/runtimes/types';
import type { System } from '../src/system';
import { heartbeatDue, LocalDispatcher, tick } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

const fake = path.join(__dirname, 'fixtures', 'fake-cli.mjs');
let sys: System;
let server: ReturnType<typeof serve>;
const tokens = new RunTokens();
const bus = new Bus();
let mode = 'mcp';
let starts = 0;

function countingRuntime(): Runtime {
  const inner = () =>
    createCliRuntime('claude-cli', { command: { command: process.execPath, prefixArgs: [fake, 'claude', mode] }, baseEnv: { ...process.env, RESEND_API_KEY: 'secret' } });
  return {
    name: 'claude-cli',
    canResume: true,
    start(req: RunRequest): AsyncIterable<RunEvent> {
      starts++;
      return inner().start(req);
    },
    cancel: async () => undefined,
    health: async () => ({ ok: true }),
  };
}

class LateStore implements OsStore {
  inner!: OsStore;
  autonomy(s: RunScope) {
    return this.inner.autonomy(s);
  }
  getLead(s: RunScope, id: string) {
    return this.inner.getLead(s, id);
  }
  proposeEmail(s: RunScope, p: ProposedEmail) {
    return this.inner.proposeEmail(s, p);
  }
  getTask(s: RunScope) {
    return this.inner.getTask(s);
  }
  comment(s: RunScope, t: string) {
    return this.inner.comment(s, t);
  }
  completeTask(s: RunScope, o: string) {
    return this.inner.completeTask(s, o);
  }
  blockTask(s: RunScope, r: string) {
    return this.inner.blockTask(s, r);
  }
  askFounder(s: RunScope, q: string) {
    return this.inner.askFounder(s, q);
  }
}

let deps: LoopDeps;
const ws = () => sys.workspace.id;

async function agentId(key: string): Promise<string> {
  const r = await withWorkspace(sys.app, ws(), ({ client: c }) => c.query('select id from agents where key = $1', [key]));
  return r.rows[0].id;
}
async function addTask(assignee: string, title: string): Promise<string> {
  const r = await withWorkspace(sys.app, ws(), ({ client: c }) =>
    c.query("insert into tasks (workspace_id, assignee_id, title, body, created_by) values ($1, $2, $3, 'Use the company file.', 'founder') returning id", [ws(), assignee, title]),
  );
  return r.rows[0].id;
}
async function task(id: string) {
  return (await withWorkspace(sys.app, ws(), ({ client: c }) => c.query('select status, blocked_reason from tasks where id = $1', [id]))).rows[0];
}

beforeAll(async () => {
  // The os server starts before the database exists, so it gets a store that is filled in below.
  const store = new LateStore();
  const app = new Hono().route('/mcp', mcpRoutes({ tokens, store }));
  await new Promise<void>((r) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => r());
  });
  sys = (await testSystem(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)).sys;
  store.inner = new DbOsStore(sys.app);
  await agentNew(sys, { template: 'researcher', department: 'research' });
  await agentNew(sys, { template: 'writer', department: 'outreach' });
  deps = { pool: sys.app, tokens, bus, runtimes: { 'claude-cli': countingRuntime() }, dataDir: sys.dataDir, workspaceSlug: sys.workspace.slug, templatesRoot: sys.templatesRoot, timeoutMs: 20_000 };
}, 180_000);
afterAll(async () => {
  server?.close();
  await sys?.close();
});

describe('run loop (S0-8)', () => {
  it('a run for an agent with no tasks makes no CLI call', async () => {
    starts = 0;
    const out = await executeRun(deps, ws(), await agentId('research-researcher'), 'manual');
    expect(out).toEqual({ status: 'no_task' });
    expect(starts).toBe(0);
  });

  it('two checkouts at the same moment never take the same task', async () => {
    const writer = await agentId('outreach-writer');
    const t1 = await addTask(writer, 'one');
    const [a, b] = await Promise.all([checkoutTask(sys.app, ws(), writer), checkoutTask(sys.app, ws(), writer)]);
    expect([a?.id, b?.id].filter(Boolean)).toEqual([t1]);
    await withWorkspace(sys.app, ws(), ({ client: c }) => c.query("update tasks set status = 'cancelled' where id = $1", [t1]));
  });

  it('runs a task end to end: the agent reads and completes it through the os server, events are stored in order', async () => {
    mode = 'mcp';
    const researcher = await agentId('research-researcher');
    const t = await addTask(researcher, 'List five facts from the company file');
    const seen: string[] = [];
    const off = bus.subscribe((m) => m.kind === 'run.event' && seen.push(m.event.type));
    const out = await executeRun(deps, ws(), researcher, 'manual');
    off();
    expect(out.status).toBe('succeeded');
    expect(await task(t)).toMatchObject({ status: 'done' });
    const run = await withWorkspace(sys.app, ws(), ({ client: c }) => c.query('select status, session_id, trigger from runs where task_id = $1', [t]));
    expect(run.rows[0]).toMatchObject({ status: 'succeeded', trigger: 'manual' });
    const events = await withWorkspace(sys.app, ws(), ({ client: c }) => c.query('select type, data from run_events where run_id = (select id from runs where task_id = $1) order by id', [t]));
    expect(events.rows.map((r) => r.type)).toEqual(seen);
    expect(events.rows[0].type).toBe('session');
    expect(events.rows.at(-1).type).toBe('done');
    const thread = await withWorkspace(sys.app, ws(), ({ client: c }) => c.query('select from_id, body from messages where task_id = $1', [t]));
    expect(thread.rows).toEqual([{ from_id: 'agent:research-researcher', body: 'Five facts.' }]);
    const audit = await withWorkspace(sys.app, ws(), ({ client: c }) => c.query("select action from audit_log where action like 'run.%' order by id"));
    expect(audit.rows.map((r) => r.action)).toEqual(['run.running', 'run.succeeded']);
  });

  it('a failed run blocks its task with the reason and ends failed', async () => {
    mode = 'limit';
    const researcher = await agentId('research-researcher');
    const t = await addTask(researcher, 'Another task');
    const out = await executeRun(deps, ws(), researcher, 'manual');
    expect(out).toMatchObject({ status: 'failed', error: { kind: 'limit' } });
    expect((await task(t)).status).toBe('blocked');
    expect((await task(t)).blocked_reason).toMatch(/limit/);
  });

  it('a paused agent does not run', async () => {
    const writer = await agentId('outreach-writer');
    await withWorkspace(sys.app, ws(), ({ client: c }) => c.query("update agents set status = 'paused' where id = $1", [writer]));
    expect(await executeRun(deps, ws(), writer, 'manual')).toMatchObject({ status: 'not_runnable' });
    await withWorkspace(sys.app, ws(), ({ client: c }) => c.query("update agents set status = 'active' where id = $1", [writer]));
  });
});

describe('dispatcher and ticker (S0-8)', () => {
  it('never runs the same agent twice at once, and at most two runs overall', async () => {
    let active = 0;
    let peak = 0;
    const perAgent = new Map<string, number>();
    let overlap = false;
    const d = new LocalDispatcher(async (e) => {
      active++;
      peak = Math.max(peak, active);
      perAgent.set(e.agentId, (perAgent.get(e.agentId) ?? 0) + 1);
      if (perAgent.get(e.agentId)! > 1) overlap = true;
      await new Promise((r) => setTimeout(r, 30));
      perAgent.set(e.agentId, perAgent.get(e.agentId)! - 1);
      active--;
      return { status: 'no_task' };
    });
    for (const a of ['a', 'a', 'a', 'b', 'c', 'b']) await d.request({ workspaceId: 'w', agentId: a, trigger: 'manual' });
    await d.idle();
    expect(overlap).toBe(false);
    expect(peak).toBe(2);
  });

  it('decides when a heartbeat is due', () => {
    // Heartbeats follow the machine's local time, so a 9am cron means 9am where the founder is.
    const now = new Date(2026, 10, 16, 9, 0, 30);
    expect(heartbeatDue('0 9 * * 1-5', null, now)).toBe(true);
    expect(heartbeatDue('0 9 * * 1-5', new Date(2026, 10, 16, 9, 0, 5), now)).toBe(false);
    expect(heartbeatDue('0 9 * * 1-5', new Date(2026, 10, 13, 9, 0, 5), now)).toBe(true);
    expect(heartbeatDue('not a cron', null, now)).toBe(false);
  });

  it('the ticker requests runs only for due, active agents with a heartbeat', async () => {
    const lead = await agentId('outreach-writer');
    await withWorkspace(sys.app, ws(), ({ client: c }) => c.query("update agents set heartbeat_cron = '* * * * *' where id = $1", [lead]));
    const sent: string[] = [];
    const due = await tick(sys.app, ws(), { name: 'local', request: async (e) => void sent.push(e.agentId) });
    expect(due).toEqual([lead]);
    expect(sent).toEqual([lead]);
  });
});
