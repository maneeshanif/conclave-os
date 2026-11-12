import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { executeRun, type LoopDeps } from '../src/harness/loop';
import { MemoryOsStore } from '../src/harness/os-tools';
import { liftExpiredPauses, parseResetTime } from '../src/harness/pauses';
import { RunTokens } from '../src/harness/run-tokens';
import type { Runtime, RunEvent, RunRequest } from '../src/runtimes/types';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

const NOW = new Date('2026-11-13T12:00:00Z');
const epoch = (d: Date) => Math.floor(d.getTime() / 1000);

describe('reading the reset time out of a limit message (S3-3)', () => {
  it('reads a Unix time in seconds or milliseconds after a bar', () => {
    const at = new Date('2026-11-13T17:00:00Z');
    expect(parseResetTime(`Claude AI usage limit reached|${epoch(at)}`, NOW)).toEqual(at);
    expect(parseResetTime(`usage limit reached|${at.getTime()}`, NOW)).toEqual(at);
  });

  it('falls back to five hours when there is none, or it is in the past or absurdly far away', () => {
    const fiveHours = new Date(NOW.getTime() + 5 * 3_600_000);
    expect(parseResetTime('You have hit your limit, resets soon', NOW)).toEqual(fiveHours);
    expect(parseResetTime(`usage limit reached|${epoch(new Date('2026-11-13T09:00:00Z'))}`, NOW)).toEqual(fiveHours);
    expect(parseResetTime(`usage limit reached|${epoch(new Date('2027-06-01T00:00:00Z'))}`, NOW)).toEqual(fiveHours);
  });
});

let sys: System;
let app: ReturnType<typeof createApp>;
let a1 = '';
let a2 = '';
let oc = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const call = (method: string, p: string, body?: unknown) => app.request(`/api${p}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });

class Scripted implements Runtime {
  canResume = true;
  starts = 0;
  constructor(
    public name: 'claude-cli' | 'opencode',
    private events: (req: RunRequest) => RunEvent[],
  ) {}
  async *start(req: RunRequest): AsyncIterable<RunEvent> {
    this.starts++;
    for (const e of this.events(req)) yield e;
  }
  async cancel() {}
  async health() {
    return { ok: true };
  }
}
const ok = (): RunEvent[] => [{ type: 'session', sessionId: 'ses_x' }, { type: 'done', output: 'done' }];
const limited = (until: Date) => (): RunEvent[] => [{ type: 'session', sessionId: 'ses_x' }, { type: 'error', kind: 'limit', message: `Claude AI usage limit reached|${epoch(until)}` }];

function deps(claude: Runtime, opencode?: Runtime, now = () => NOW): LoopDeps & { now: () => Date } {
  return { pool: sys.app, tokens: new RunTokens(), bus: new Bus(), runtimes: { 'claude-cli': claude, ...(opencode ? { opencode } : {}) }, dataDir: sys.dataDir, workspaceSlug: sys.workspace.slug, templatesRoot: sys.templatesRoot, timeoutMs: 30_000, now };
}
const addTask = async (agent: string, title = 'Work') => (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, $2, 'todo', $3, 'founder') returning id", [ws(), title, agent])).rows[0].id as string;
const task = async (id: string) => (await sql('select status, blocked_reason, session_id, locked_by from tasks where id = $1', [id])).rows[0];
const pauses = async () => (await sql('select runtime, until, reason, lifted_at, lifted_by from runtime_pauses order by created_at')).rows;
const items = async () => (await sql("select kind, status, title from action_items where kind = 'runtime_paused'")).rows;

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'pl-1' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'pl-2' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'pl-oc', runtime: 'opencode', model: 'any-model' });
  const ids = await Promise.all(['pl-1', 'pl-2', 'pl-oc'].map(async (k) => (await sql('select id from agents where key = $1', [k])).rows[0].id as string));
  [a1, a2, oc] = ids as [string, string, string];
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  await sql('delete from run_events');
  await sql('delete from runs');
  await sql('delete from messages where task_id in (select id from tasks where assignee_id = any($1))', [[a1, a2, oc]]);
  await sql('delete from tasks where assignee_id = any($1)', [[a1, a2, oc]]);
  await sql('delete from runtime_pauses');
  await sql("delete from action_items where kind = 'runtime_paused'");
});

describe('a plan limit pauses the runtime, not the work (S3-3)', () => {
  it('pauses every agent on that runtime until the reset, leaves the task queued with its session, and raises one item', async () => {
    const until = new Date('2026-11-13T17:00:00Z');
    const t = await addTask(a1);
    const claude = new Scripted('claude-cli', limited(until));
    const out = await executeRun(deps(claude), ws(), a1, 'manual');
    expect(out.status).toBe('failed');
    expect(await task(t)).toMatchObject({ status: 'todo', locked_by: null, session_id: 'ses_x' }); // queued, not blocked
    const [p] = await pauses();
    expect(p).toMatchObject({ runtime: 'claude-cli', lifted_at: null });
    expect(new Date(p.until)).toEqual(until);
    const its = await items();
    expect(its).toHaveLength(1);
    expect(its[0]!.title).toMatch(/Claude Code|claude-cli/);
    expect(its[0]!.status).toBe('open');

    // The other agent on the same runtime does not start, and takes no task.
    const t2 = await addTask(a2);
    const second = await executeRun(deps(claude), ws(), a2, 'manual');
    expect(second).toMatchObject({ status: 'not_runnable', reason: expect.stringMatching(/paused until/) });
    expect(claude.starts).toBe(1);
    expect(await task(t2)).toMatchObject({ status: 'todo', locked_by: null });
  });

  it('does not touch agents on another runtime', async () => {
    await addTask(a1);
    await executeRun(deps(new Scripted('claude-cli', limited(new Date('2026-11-13T17:00:00Z')))), ws(), a1, 'manual');
    const t = await addTask(oc);
    const open = new Scripted('opencode', ok);
    const out = await executeRun(deps(new Scripted('claude-cli', ok), open), ws(), oc, 'manual');
    expect(out.status).toBe('succeeded');
    expect((await task(t)).status).toBe('done');
  });

  it('raises one item however many runs hit the limit, and keeps the later reset', async () => {
    const early = new Date('2026-11-13T15:00:00Z');
    const late = new Date('2026-11-13T18:00:00Z');
    await addTask(a1);
    await addTask(a2);
    // Both were already running when the limit came; each reports it.
    await Promise.all([executeRun(deps(new Scripted('claude-cli', limited(early))), ws(), a1, 'manual'), executeRun(deps(new Scripted('claude-cli', limited(late))), ws(), a2, 'manual')]);
    expect(await items()).toHaveLength(1);
    const active = (await pauses()).filter((p) => p.lifted_at === null);
    expect(active).toHaveLength(1);
    expect(new Date(active[0]!.until)).toEqual(late);
  });

  it('starts again by itself at the reset, closes the item, and says which agents have work waiting', async () => {
    const until = new Date('2026-11-13T17:00:00Z');
    const t = await addTask(a1);
    await executeRun(deps(new Scripted('claude-cli', limited(until))), ws(), a1, 'manual');

    // Before the reset: nothing lifts.
    expect(await liftExpiredPauses({ pool: sys.app, workspaceId: ws(), now: () => new Date('2026-11-13T16:59:00Z') })).toEqual({ lifted: [], agentsWithWork: [] });
    expect((await executeRun(deps(new Scripted('claude-cli', ok), undefined, () => new Date('2026-11-13T16:59:00Z')), ws(), a1, 'manual')).status).toBe('not_runnable');

    const lifted = await liftExpiredPauses({ pool: sys.app, workspaceId: ws(), now: () => new Date('2026-11-13T17:00:01Z') });
    expect(lifted.lifted).toEqual(['claude-cli']);
    expect(lifted.agentsWithWork).toEqual([a1]);
    expect((await items())[0]!.status).toBe('done');
    expect((await pauses())[0]).toMatchObject({ lifted_by: 'system' });
    const rt = new Scripted('claude-cli', ok);
    expect((await executeRun(deps(rt, undefined, () => new Date('2026-11-13T17:00:02Z')), ws(), a1, 'manual')).status).toBe('succeeded');
    expect((await task(t)).status).toBe('done');
    expect(rt.starts).toBe(1);
  });

  it('treats a pause whose time has passed as over even if nobody lifted it yet', async () => {
    await addTask(a1);
    await executeRun(deps(new Scripted('claude-cli', limited(new Date('2026-11-13T13:00:00Z')))), ws(), a1, 'manual');
    const later = () => new Date('2026-11-13T13:30:00Z');
    const first = (await sql('select id from tasks where assignee_id = $1 order by created_at limit 1', [a1])).rows[0].id as string;
    expect((await executeRun(deps(new Scripted('claude-cli', ok), undefined, later), ws(), a1, 'manual')).status).toBe('succeeded');
    expect((await task(first)).status).toBe('done'); // the task that was waiting, with no lifting needed
  });

  it('can be lifted early by a person, which also closes the item; lifting twice is harmless', async () => {
    await addTask(a1);
    await executeRun(deps(new Scripted('claude-cli', limited(new Date('2026-11-13T17:00:00Z')))), ws(), a1, 'manual');
    const list = (await (await call('GET', '/runtime-pauses')).json()) as { runtime: string }[];
    expect(list.map((p) => p.runtime)).toEqual(['claude-cli']);
    expect((await call('POST', '/runtime-pauses/claude-cli/lift', {})).status).toBe(200);
    expect((await call('POST', '/runtime-pauses/claude-cli/lift', {})).status).toBe(404); // nothing left to lift
    expect(((await (await call('GET', '/runtime-pauses')).json()) as unknown[]).length).toBe(0);
    expect((await pauses())[0]).toMatchObject({ lifted_by: 'founder' });
    expect((await items())[0]!.status).toBe('done');
    const t = await addTask(a2);
    expect((await executeRun(deps(new Scripted('claude-cli', ok)), ws(), a2, 'manual')).status).toBe('succeeded');
    expect((await task(t)).status).toBe('done');
  });

  it('uses the default wait when the message gives no time', async () => {
    await addTask(a1);
    await executeRun(deps(new Scripted('claude-cli', () => [{ type: 'error', kind: 'limit', message: 'You have hit your limit' }])), ws(), a1, 'manual');
    expect(new Date((await pauses())[0]!.until)).toEqual(new Date(NOW.getTime() + 5 * 3_600_000));
  });

  it('does not pause for a rate limit that a retry can ride out', async () => {
    await addTask(a1);
    await executeRun(deps(new Scripted('claude-cli', () => [{ type: 'error', kind: 'limit', message: 'Rate limit exceeded: too many requests (429)' }])), ws(), a1, 'manual');
    expect(await pauses()).toEqual([]);
    expect(await items()).toEqual([]);
  });
});
