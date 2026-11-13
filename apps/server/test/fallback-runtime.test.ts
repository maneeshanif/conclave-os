import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseRoleFile } from '../src/company/loader';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { executeRun, type LoopDeps } from '../src/harness/loop';
import { pauseRuntime } from '../src/harness/pauses';
import { RunTokens } from '../src/harness/run-tokens';
import type { RuntimeName } from '../src/runtimes/names';
import type { Runtime, RunEvent, RunRequest } from '../src/runtimes/types';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

const NOW = new Date('2026-11-13T12:00:00Z');
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const BAD = `Subject: x\n\n${words(200)}`;
const GOOD = 'Subject: A concept for you\n\nHi Dana, your booking page asks people to phone first. Happy to share a concept if useful.';

let sys: System;
const ids: Record<string, string> = {};
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

class Scripted implements Runtime {
  canResume = true;
  requests: RunRequest[] = [];
  constructor(
    public name: RuntimeName,
    private outputs: string[],
  ) {}
  async *start(req: RunRequest): AsyncIterable<RunEvent> {
    const out = this.outputs[Math.min(this.requests.length, this.outputs.length - 1)]!;
    this.requests.push(req);
    yield { type: 'session', sessionId: `${this.name}-session` };
    yield { type: 'done', output: out };
  }
  async cancel() {}
  async health() {
    return { ok: true };
  }
}
type Prepared = { key: string; runtime?: string; model?: string };
function setup(claude: Scripted, local: Scripted) {
  const prepared: Prepared[] = [];
  const deps: LoopDeps & { now: () => Date } = {
    pool: sys.app,
    tokens: new RunTokens(),
    bus: { publish: () => undefined } as never,
    runtimes: { 'claude-cli': claude, 'openai-agents': local },
    dataDir: sys.dataDir,
    workspaceSlug: sys.workspace.slug,
    templatesRoot: sys.templatesRoot,
    timeoutMs: 30_000,
    now: () => NOW,
    prepare: async (key, over) => void prepared.push({ key, ...(over ? { runtime: over.runtime, model: over.model } : {}) }),
  };
  return { deps, prepared };
}
const addTask = async (agent: string) => (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, 'Work', 'todo', $2, 'founder') returning id", [ws(), agent])).rows[0].id as string;
const task = async (id: string) => (await sql('select status, session_id, blocked_reason from tasks where id = $1', [id])).rows[0];
const lastRun = async (agent: string) => (await sql('select id, runtime, model, status from runs where agent_id = $1 order by started_at desc limit 1', [agent])).rows[0];
const reroutes = async (runId: string) => (await sql("select data from run_events where run_id = $1 and type = 'reroute' order by id", [runId])).rows.map((r) => r.data);

beforeAll(async () => {
  ({ sys } = await testSystem());
  // A scout that normally runs on Claude and may fall back to the local model; a local scout that may escalate to Claude; a writer with no fallback.
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'fb-claude-scout' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'fb-local-scout', runtime: 'openai-agents', model: 'local-worker' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'fb-writer' });
  for (const k of ['fb-claude-scout', 'fb-local-scout', 'fb-writer']) ids[k] = (await sql('select id from agents where key = $1', [k])).rows[0].id;
  await sql("update agents set fallback_runtime = 'openai-agents', fallback_alias = 'local-worker' where id = $1", [ids['fb-claude-scout']]);
  await sql("update agents set fallback_runtime = 'claude-cli', fallback_alias = 'researcher', output_check = 'email-draft' where id = $1", [ids['fb-local-scout']]);
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  for (const t of ['run_events', 'approvals', 'runs', 'runtime_pauses']) await sql(`delete from ${t}`);
  await sql('delete from messages where task_id in (select id from tasks)');
  await sql('delete from tasks');
  await sql("delete from action_items where kind = 'runtime_paused'");
});

describe('the fallback runtime in the role file (S4-5)', () => {
  const role = (extra: string, runtime = 'claude-cli', model = 'researcher') => `---\nid: scout\nname: Scout\ndepartment: research\nruntime: ${runtime}\nmodel: ${model}\n${extra}\n---\n\n# Role\nYou scout.\n`;

  it('accepts a fallback on another runtime whose alias works there', () => {
    const r = parseRoleFile(role('fallback_runtime: openai-agents\nfallback_model: local-worker'), 'a/AGENT.md').role;
    expect(r.fallback_runtime).toBe('openai-agents');
  });

  it('refuses a fallback runtime without a fallback model, an alias that does not work there, and an unknown runtime', () => {
    expect(() => parseRoleFile(role('fallback_runtime: openai-agents'), 'a/AGENT.md')).toThrow(/fallback_runtime.*fallback_model/s);
    expect(() => parseRoleFile(role('fallback_runtime: openai-agents\nfallback_model: writer'), 'a/AGENT.md')).toThrow(/fallback alias "writer" does not list runtime "openai-agents"/);
    expect(() => parseRoleFile(role('fallback_runtime: nonsense\nfallback_model: writer'), 'a/AGENT.md')).toThrow(/unknown runtime "nonsense"/);
  });

  it('keeps the old meaning when there is no fallback runtime: the fallback model is for the same runtime', () => {
    expect(() => parseRoleFile(role('fallback_model: local-worker'), 'a/AGENT.md')).toThrow(/does not list runtime "claude-cli"/);
    expect(parseRoleFile(role('fallback_model: strong-writer'), 'a/AGENT.md').role.fallback_model).toBe('strong-writer');
  });
});

describe('moving short jobs to the local model while Claude is paused (S4-5)', () => {
  it('runs the scout on its fallback runtime while the primary is paused, and records the move', async () => {
    await withWorkspace(sys.app, ws(), ({ client }) => pauseRuntime(client, ws(), 'claude-cli', new Date('2026-11-13T17:00:00Z'), 'usage limit'));
    const claude = new Scripted('claude-cli', ['done']);
    const local = new Scripted('openai-agents', ['found three signals']);
    const { deps, prepared } = setup(claude, local);
    const t = await addTask(ids['fb-claude-scout']!);
    const out = await executeRun(deps, ws(), ids['fb-claude-scout']!, 'manual');
    expect(out.status).toBe('succeeded');
    expect(claude.requests).toHaveLength(0);
    expect(local.requests).toHaveLength(1);
    expect(local.requests[0]!.modelAlias).toBe('local-worker');
    expect(prepared).toEqual([{ key: 'fb-claude-scout', runtime: 'openai-agents', model: 'local-worker' }]);
    const run = await lastRun(ids['fb-claude-scout']!);
    expect(run).toMatchObject({ runtime: 'openai-agents', model: 'local-worker' });
    expect((await reroutes(run.id))[0]).toMatchObject({ from: 'claude-cli', to: 'openai-agents', reason: 'paused' });
    expect((await task(t)).status).toBe('done');
  });

  it('leaves a writer with no fallback queued while Claude is paused', async () => {
    await withWorkspace(sys.app, ws(), ({ client }) => pauseRuntime(client, ws(), 'claude-cli', new Date('2026-11-13T17:00:00Z'), 'usage limit'));
    const { deps } = setup(new Scripted('claude-cli', ['x']), new Scripted('openai-agents', ['x']));
    const t = await addTask(ids['fb-writer']!);
    const out = await executeRun(deps, ws(), ids['fb-writer']!, 'manual');
    expect(out.status).toBe('not_runnable');
    expect((await task(t)).status).toBe('todo');
  });

  it('does not reroute when both runtimes are paused, and goes back to the primary after the lift', async () => {
    const until = new Date('2026-11-13T17:00:00Z');
    await withWorkspace(sys.app, ws(), async ({ client }) => {
      await pauseRuntime(client, ws(), 'claude-cli', until, 'limit');
      await pauseRuntime(client, ws(), 'openai-agents', until, 'limit');
    });
    const claude = new Scripted('claude-cli', ['ok']);
    const local = new Scripted('openai-agents', ['ok']);
    const { deps } = setup(claude, local);
    await addTask(ids['fb-claude-scout']!);
    expect((await executeRun(deps, ws(), ids['fb-claude-scout']!, 'manual')).status).toBe('not_runnable');
    await sql('delete from runtime_pauses');
    expect((await executeRun(deps, ws(), ids['fb-claude-scout']!, 'manual')).status).toBe('succeeded');
    expect(claude.requests).toHaveLength(1);
    expect(local.requests).toHaveLength(0);
  });

  it('starts the fallback run fresh: it never resumes a session from the other engine', async () => {
    const t = await addTask(ids['fb-claude-scout']!);
    await sql("update tasks set session_id = 'claude-session-from-before' where id = $1", [t]);
    await withWorkspace(sys.app, ws(), ({ client }) => pauseRuntime(client, ws(), 'claude-cli', new Date('2026-11-13T17:00:00Z'), 'limit'));
    const local = new Scripted('openai-agents', ['ok']);
    await executeRun(setup(new Scripted('claude-cli', ['x']), local).deps, ws(), ids['fb-claude-scout']!, 'manual');
    expect(local.requests[0]!.sessionId).toBeUndefined();
  });
});

describe('escalating from the local model to Claude when a check fails (S4-5)', () => {
  it('repairs once on the local model, then escalates once to Claude, which fixes it', async () => {
    const claude = new Scripted('claude-cli', [GOOD]);
    const local = new Scripted('openai-agents', [BAD]);
    const { deps, prepared } = setup(claude, local);
    const t = await addTask(ids['fb-local-scout']!);
    const out = await executeRun(deps, ws(), ids['fb-local-scout']!, 'manual');
    expect(out.status).toBe('succeeded');
    expect(local.requests).toHaveLength(2); // the first try and the repair
    expect(claude.requests).toHaveLength(1);
    expect(claude.requests[0]!.modelAlias).toBe('researcher');
    expect(claude.requests[0]!.sessionId).toBeUndefined(); // another engine: no session to resume
    expect(claude.requests[0]!.taskInput).toMatch(/failed the email-draft check/);
    expect(prepared.at(-1)).toMatchObject({ key: 'fb-local-scout', runtime: 'claude-cli', model: 'researcher' });
    const run = await lastRun(ids['fb-local-scout']!);
    expect(run.runtime).toBe('claude-cli'); // the run row says where it ended up
    expect((await reroutes(run.id))[0]).toMatchObject({ from: 'openai-agents', to: 'claude-cli', reason: 'escalate' });
    expect((await task(t)).status).toBe('done');
  });

  it('blocks the task, having tried Claude exactly once, when Claude fails the check too', async () => {
    const claude = new Scripted('claude-cli', [BAD]);
    const local = new Scripted('openai-agents', [BAD]);
    const t = await addTask(ids['fb-local-scout']!);
    const out = await executeRun(setup(claude, local).deps, ws(), ids['fb-local-scout']!, 'manual');
    expect(out.status).toBe('failed');
    expect(local.requests).toHaveLength(2);
    expect(claude.requests).toHaveLength(1);
    expect((await task(t)).status).toBe('blocked');
  });

  it('is unchanged for an agent whose fallback is on its own runtime', async () => {
    await sql("update agents set fallback_runtime = null, fallback_alias = 'strong-writer' where id = $1", [ids['fb-writer']!]);
    const claude = new Scripted('claude-cli', ['fine']);
    await addTask(ids['fb-writer']!);
    expect((await executeRun(setup(claude, new Scripted('openai-agents', ['x'])).deps, ws(), ids['fb-writer']!, 'manual')).status).toBe('succeeded');
    expect(claude.requests).toHaveLength(1);
  });
});
