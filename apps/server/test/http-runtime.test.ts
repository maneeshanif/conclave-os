import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { mcpRoutes } from '../src/routes/mcp';
import { conformanceCases, type ConformanceDeps } from '../src/runtimes/conformance';
import { BUILT_RUNTIMES } from '../src/runtimes/names';
import { createHttpRuntime, toEvent } from '../src/runtimes/http';
import type { RunEvent, RunRequest } from '../src/runtimes/types';
import { startFakeWorker, type FakeWorker } from './fixtures/fake-http-worker';

const SECRETS = { RESEND_API_KEY: 'sk_live_resend_x', DATABASE_URL: 'postgres://secret-db', ANTHROPIC_API_KEY: 'sk-ant-secret-x', SECRETS_KEY: 'secret-key-x' };

class Store extends MemoryOsStore {
  taskStatus(id: string) {
    return this.tasks.get(id)?.status;
  }
}

let osServer: ReturnType<typeof serve>;
let osUrl = '';
let worker: FakeWorker;
let work = '';
const tokens = new RunTokens();
const store = new Store();
let n = 0;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const [k, v] of Object.entries(SECRETS)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const app = new Hono().route('/mcp', mcpRoutes({ tokens, store }));
  await new Promise<void>((r) => {
    osServer = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => r());
  });
  osUrl = `http://127.0.0.1:${(osServer.address() as AddressInfo).port}/mcp`;
  worker = await startFakeWorker();
  work = await mkdtemp(path.join(tmpdir(), 'conclave-http-'));
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  osServer?.close();
  await worker?.close();
  await rm(work, { recursive: true, force: true });
});

const runtimeFor = (mode: string, extra: Partial<Parameters<typeof createHttpRuntime>[0]> = {}) => createHttpRuntime({ url: worker.url(mode), osUrl, ...extra });

function deps(): ConformanceDeps {
  return {
    make: (mode) => runtimeFor(mode),
    async request(over: Partial<RunRequest> = {}) {
      return { runId: `run-http-${++n}`, workspaceId: 'ws', agentId: 'agent-http', agentKey: 'py-worker', instructions: 'Use the os tools.', taskInput: 'List five facts', workspaceDir: work, modelAlias: 'any-model', maxTurns: 10, runToken: '', timeoutMs: 20_000, ...over };
    },
    tokens,
    store,
    secretNames: Object.keys(SECRETS),
    newTask(workspaceId) {
      const id = `task-http-${++n}`;
      store.tasks.set(id, { id, workspaceId, title: 'List five facts', body: null, status: 'in_progress' });
      return id;
    },
  };
}

async function collect(it: AsyncIterable<RunEvent>) {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
async function request(over: Partial<RunRequest> = {}) {
  const d = deps();
  const base = await d.request(over);
  const taskId = d.newTask('ws');
  return { ...base, taskId, runToken: tokens.issue({ workspaceId: 'ws', agentId: base.agentId, runId: base.runId, taskId }) };
}

describe('runtime conformance: http (S9-1)', () => {
  it('is a built runtime', () => {
    expect(BUILT_RUNTIMES).toContain('http');
  });
  for (const c of conformanceCases) {
    it(`${c.point}. ${c.name}`, () => c.run(deps()), 30_000);
  }
});

describe('the http runtime in detail (S9-1)', () => {
  it('sends the worker the task, the os endpoint and this run token, and no environment or server secret', async () => {
    const before = worker.seen.length;
    const req = await request({ sessionId: 'resume-me' });
    await collect(runtimeFor('ok').start(req));
    const sent = worker.seen.slice(before);
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]!.body) as Record<string, unknown>;
    expect(body).toMatchObject({ runId: req.runId, agentKey: 'py-worker', task: 'List five facts', sessionId: 'resume-me', os: { url: osUrl, token: req.runToken } });
    for (const v of Object.values(SECRETS)) expect(sent[0]!.body.includes(v) || JSON.stringify(sent[0]!.headers).includes(v)).toBe(false);
    expect(sent[0]!.headers.authorization).toBeUndefined(); // no worker key unless one is configured
  });

  it('sends a worker key only when one is given, and never the run token in a header', async () => {
    const before = worker.seen.length;
    const req = await request();
    await collect(runtimeFor('ok', { workerKey: 'worker-key-9' }).start(req));
    const h = worker.seen[before]!.headers;
    expect(h.authorization).toBe('Bearer worker-key-9');
    expect(JSON.stringify(h)).not.toContain(req.runToken);
  });

  it('hides the run token even if the worker repeats it in its own words, and in a plain JSON answer', async () => {
    const req = await request();
    const leaked = await collect(runtimeFor('leak').start(req));
    expect(JSON.stringify(leaked)).not.toContain(req.runToken);
    expect(JSON.stringify(leaked)).toContain('[token]');
    const req2 = await request();
    const plain = await collect(runtimeFor('json').start(req2));
    expect(plain.at(-1)).toMatchObject({ type: 'done', output: 'Plain answer, token [token]' });
  });

  it('always ends with exactly one done or error: a worker that stops short, sends junk, or is not there', async () => {
    const cut = await collect(runtimeFor('cut').start(await request()));
    expect(cut.at(-1)).toMatchObject({ type: 'error', kind: 'runtime' });
    const junk = await collect(runtimeFor('garbage').start(await request()));
    expect(junk.filter((e) => e.type === 'done' || e.type === 'error')).toHaveLength(1);
    expect(junk.at(-1)?.type).toBe('done');
    const down = await collect(createHttpRuntime({ url: 'http://127.0.0.1:9/x', osUrl }).start(await request()));
    expect(down.at(-1)).toMatchObject({ type: 'error', kind: 'runtime', message: expect.stringMatching(/cannot be reached/) });
  });

  it('times out a worker that never answers', async () => {
    const events = await collect(runtimeFor('hang').start(await request({ timeoutMs: 300 })));
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'timeout' });
  });

  it('refuses a worker that is not on this machine unless remote workers are allowed, and a bad address', async () => {
    const remote = await collect(createHttpRuntime({ url: 'http://workers.example.test/run', osUrl }).start(await request()));
    expect(remote.at(-1)).toMatchObject({ type: 'error', kind: 'config', message: expect.stringMatching(/not on this machine/) });
    const bad = await collect(createHttpRuntime({ url: 'file:///etc/passwd', osUrl }).start(await request()));
    expect(bad.at(-1)).toMatchObject({ type: 'error', kind: 'config' });
    const none = await collect(createHttpRuntime({ url: () => undefined, osUrl }).start(await request()));
    expect(none.at(-1)).toMatchObject({ type: 'error', kind: 'config', message: expect.stringMatching(/No worker address/) });
  });

  it('reads only well-formed events from the worker', () => {
    expect(toEvent({ type: 'done', output: 'x' })).toEqual({ type: 'done', output: 'x' });
    expect(toEvent({ type: 'tool_result', tool: 't', ok: 'yes', summary: 's' })).toMatchObject({ ok: false });
    expect(toEvent({ type: 'surprise' })).toBeNull();
    expect(toEvent('text')).toBeNull();
    expect(toEvent({ type: 'error', kind: 'made-up', message: '' })).toMatchObject({ kind: 'runtime' });
  });
});
