import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildBrief } from '../src/brief/build';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { buildHealth } from '../src/health';
import { DbOsStore } from '../src/harness/db-os-store';
import { executeRun, type LoopDeps } from '../src/harness/loop';
import { pauseRuntime } from '../src/harness/pauses';
import { RunTokens } from '../src/harness/run-tokens';
import { mcpRoutes } from '../src/routes/mcp';
import { createOpenAIAgentsRuntime } from '../src/runtimes/openai-agents';
import type { Runtime, RunEvent, RunRequest } from '../src/runtimes/types';
import type { System } from '../src/system';
import { LocalDispatcher, tick } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';
import { startFakeOpenAI, type FakeOpenAI } from './fixtures/fake-openai';

/**
 * Slice 4 end to end (S4-10, SPEC 18 row 4): scouts run around the clock on the local model and you get a short list of
 * qualified signals each morning. The real in-process runner, `os` server, database store, run loop, ticker, checks, pauses
 * and brief; the models are stand-ins (a fake OpenAI-compatible endpoint for the local model, a scripted Claude).
 */
const HEARTBEAT = new Date('2026-11-13T09:00:30Z'); // 30 seconds after an hour: due on "0 * * * *"
const MORNING = new Date('2026-11-14T06:30:00Z');
let sys: System;
let osServer: ReturnType<typeof serve>;
let fake: FakeOpenAI;
let dispatcher: LocalDispatcher;
let deps: LoopDeps & { now: () => Date };
const ids: Record<string, string> = {};
const tokens = new RunTokens();
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

class ScriptedClaude implements Runtime {
  name = 'claude-cli' as const;
  canResume = true;
  requests: RunRequest[] = [];
  constructor(private output: string) {}
  async *start(req: RunRequest): AsyncIterable<RunEvent> {
    this.requests.push(req);
    yield { type: 'session', sessionId: 'claude-session' };
    yield { type: 'done', output: this.output };
  }
  async cancel() {}
  async health() {
    return { ok: true };
  }
}
const claude = new ScriptedClaude('Subject: A concept for your booking page\n\nHi Dana, your page asks people to phone first. Happy to share a concept if useful.');
const task = async (id: string) => (await sql('select status, blocked_reason from tasks where id = $1', [id])).rows[0];
const addTask = async (agent: string, title: string) => (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, $2, 'todo', $3, 'founder') returning id", [ws(), title, agent])).rows[0].id as string;
const localRequests = (marker: string) => fake.seen.filter((s) => s.mode === 'scout' && s.body.includes(marker));

beforeAll(async () => {
  ({ sys } = await testSystem());
  fake = await startFakeOpenAI();
  const store = new DbOsStore(sys.app);
  const app = new Hono().route('/mcp', mcpRoutes({ tokens, store }));
  await new Promise<void>((r) => {
    osServer = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => r());
  });
  const osUrl = `http://127.0.0.1:${(osServer.address() as AddressInfo).port}/mcp`;
  deps = {
    pool: sys.app,
    tokens,
    bus: { publish: () => undefined } as never,
    runtimes: { 'openai-agents': createOpenAIAgentsRuntime({ osUrl, baseUrl: fake.url('scout') }), 'claude-cli': claude },
    dataDir: sys.dataDir,
    workspaceSlug: sys.workspace.slug,
    templatesRoot: sys.templatesRoot,
    timeoutMs: 60_000,
    now: () => HEARTBEAT,
  };
  dispatcher = new LocalDispatcher((e) => executeRun(deps, e.workspaceId, e.agentId, e.trigger));

  // The all-day scout (local model, escalates to Claude), and a triage agent that normally runs on Claude and may use the local model.
  await agentNew(sys, { template: 'scout', department: 'research', id: 'e2e-scout' });
  await agentNew(sys, { template: 'scout', department: 'research', id: 'e2e-scout-2' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'e2e-triage' });
  for (const k of ['e2e-scout', 'e2e-scout-2', 'e2e-triage']) ids[k] = (await sql('select id from agents where key = $1', [k])).rows[0].id;
  // A second scout whose results must be a draft (the email-draft check), with no heartbeat of its own.
  await sql("update agents set output_check = 'email-draft', heartbeat_cron = null where id = $1", [ids['e2e-scout-2']]);
  await sql("update agents set fallback_runtime = 'openai-agents', fallback_alias = 'local-worker' where id = $1", [ids['e2e-triage']]);
}, 240_000);
afterAll(async () => {
  osServer?.close();
  await fake?.close();
  await sys?.close();
});

describe('slice 4 end to end', () => {
  it('the ticker wakes the scout on its heartbeat; on the local model it records two signals through add_signal and scores them', async () => {
    const woken = await tick(sys.app, ws(), dispatcher, HEARTBEAT, new Map());
    expect(woken).toEqual([ids['e2e-scout']]);
    await dispatcher.idle();

    const run = (await sql("select runtime, model, status, trigger from runs where agent_id = $1 order by started_at desc limit 1", [ids['e2e-scout']])).rows[0];
    expect(run).toMatchObject({ runtime: 'openai-agents', model: 'local-worker', status: 'succeeded', trigger: 'heartbeat' });
    const sigs = (await sql('select url, kind, status, score, found_by from signals order by url')).rows;
    expect(sigs).toEqual([
      { url: 'https://forum.example/t/e2e2', kind: 'pain_point', status: 'new', score: 30, found_by: 'agent:e2e-scout' },
      { url: 'https://reddit.example/r/smallbiz/comments/e2e1', kind: 'service_request', status: 'qualified', score: 85, found_by: 'agent:e2e-scout' },
    ]);
    expect((await sql("select status from tasks where assignee_id = $1 and kind = 'heartbeat'", [ids['e2e-scout']])).rows[0].status).toBe('done');
    expect(claude.requests).toHaveLength(0); // nothing needed Claude
    // The same hour does not wake it again.
    expect(await tick(sys.app, ws(), dispatcher, new Date(HEARTBEAT.getTime() + 60_000), new Map())).toEqual([]);
  }, 120_000);

  it('a result that fails its check is repaired once on the local model, then escalated once to Claude, which finishes it', async () => {
    const t = await addTask(ids['e2e-scout-2']!, 'BAD-DRAFT please');
    const out = await executeRun(deps, ws(), ids['e2e-scout-2']!, 'manual');
    expect(out.status).toBe('succeeded');
    expect(localRequests('BAD-DRAFT')).toHaveLength(2); // the first try and the repair
    expect(claude.requests).toHaveLength(1);
    expect(claude.requests[0]!.sessionId).toBeUndefined();
    const run = (await sql('select runtime, model from runs where task_id = $1', [t])).rows[0];
    expect(run).toMatchObject({ runtime: 'claude-cli', model: 'researcher' }); // the run row says where it ended up
    expect((await task(t)).status).toBe('done');
  }, 120_000);

  it('a plan limit on Claude moves a triage task to the local model, while a task with no other engine would wait', async () => {
    await withWorkspace(sys.app, ws(), ({ client }) => pauseRuntime(client, ws(), 'claude-cli', new Date('2026-11-13T17:00:00Z'), 'usage limit reached'));
    const before = claude.requests.length;
    const t = await addTask(ids['e2e-triage']!, 'TRIAGE-TASK: reply from Dana');
    const out = await executeRun(deps, ws(), ids['e2e-triage']!, 'manual');
    expect(out.status).toBe('succeeded');
    expect(claude.requests).toHaveLength(before);
    expect(localRequests('TRIAGE-TASK').length).toBeGreaterThan(0);
    expect((await sql('select runtime, model from runs where task_id = $1', [t])).rows[0]).toMatchObject({ runtime: 'openai-agents', model: 'local-worker' });
    expect((await sql('select body from messages where task_id = $1', [t])).rows[0].body).toMatch(/Triaged/);
    // The Health screen shows both moves.
    const health = await withWorkspace(sys.app, ws(), ({ client }) => buildHealth(client, { hours: 24, now: new Date(HEARTBEAT.getTime() + 3_600_000) }));
    expect(health.reroutes.map((r) => r.reason).sort()).toEqual(['escalate', 'paused']);
  }, 120_000);

  it('the morning brief lists the qualified signals', async () => {
    const brief = await withWorkspace(sys.app, ws(), ({ client }) => buildBrief(client, MORNING));
    expect(brief.content.signals.waiting).toBe(1);
    expect(brief.content.signals.items).toHaveLength(1);
    expect(brief.content.signals.items[0]).toMatchObject({ url: 'https://reddit.example/r/smallbiz/comments/e2e1', score: 85, author: 'u/dana_clinic', kind: 'service_request' });
    expect(brief.summary.some((l) => /1 qualified signal waiting/.test(l))).toBe(true);
  });
});
