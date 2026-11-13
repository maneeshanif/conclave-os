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
import { createOpenAIAgentsRuntime } from '../src/runtimes/openai-agents';
import type { RunEvent, RunRequest } from '../src/runtimes/types';
import { startFakeOpenAI, type FakeOpenAI } from './fixtures/fake-openai';

const SECRETS = { RESEND_API_KEY: 'sk_live_resend_x', DATABASE_URL: 'postgres://secret-db', ANTHROPIC_API_KEY: 'sk-ant-secret-x', SECRETS_KEY: 'secret-key-x', OPENAI_API_KEY: 'sk-env-openai-secret' };

class Store extends MemoryOsStore {
  taskStatus(id: string) {
    return this.tasks.get(id)?.status;
  }
}

let osServer: ReturnType<typeof serve>;
let osUrl = '';
let fake: FakeOpenAI;
let work = '';
const tokens = new RunTokens();
const store = new Store();
let n = 0;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  // Secrets are in this process's environment on purpose: the runner must not pass any of them on.
  for (const [k, v] of Object.entries(SECRETS)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const app = new Hono().route('/mcp', mcpRoutes({ tokens, store }));
  await new Promise<void>((r) => {
    osServer = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => r());
  });
  osUrl = `http://127.0.0.1:${(osServer.address() as AddressInfo).port}/mcp`;
  fake = await startFakeOpenAI(SECRETS);
  work = await mkdtemp(path.join(tmpdir(), 'conclave-oa-'));
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  osServer?.close();
  await fake?.close();
  await rm(work, { recursive: true, force: true });
});

const runtimeFor = (mode: string, extra: { apiKey?: string } = {}) => createOpenAIAgentsRuntime({ osUrl, baseUrl: fake.url(mode), ...extra });

function deps(): ConformanceDeps {
  return {
    make: (mode) => runtimeFor(mode),
    async request(over: Partial<RunRequest> = {}) {
      return {
        runId: `run-oa-${++n}`,
        workspaceId: 'ws',
        agentId: 'agent-oa',
        agentKey: 'scout-1',
        instructions: 'You are a scout. Use the os tools.',
        taskInput: 'List five facts',
        workspaceDir: work,
        modelAlias: 'local-worker',
        maxTurns: 10,
        runToken: '',
        timeoutMs: 20_000,
        ...over,
      };
    },
    tokens,
    store,
    secretNames: Object.keys(SECRETS),
    newTask(workspaceId) {
      const id = `task-oa-${++n}`;
      store.tasks.set(id, { id, workspaceId, title: 'List five facts', body: null, status: 'in_progress' });
      return id;
    },
  };
}

describe('runtime conformance: openai-agents (S4-2)', () => {
  for (const c of conformanceCases) {
    it(`${c.point}. ${c.name}`, () => c.run(deps()), 30_000);
  }
});

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

describe('the openai-agents runtime in detail (S4-2)', () => {
  it('says it cannot resume natively, so the loop restarts the task from its comments', () => {
    expect(runtimeFor('ok').canResume).toBe(false);
    expect(runtimeFor('ok').name).toBe('openai-agents');
  });

  it('streams the tool calls and results in order, then a cost with the token counts, then done', async () => {
    const events = await collect(runtimeFor('mcp').start(await request()));
    const kinds = events.map((e) => e.type);
    expect(kinds[0]).toBe('session');
    expect(kinds.filter((k) => k === 'tool_call')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'tool_call').map((e) => (e as { tool: string }).tool)).toEqual(['get_task', 'complete_task']);
    const cost = events.find((e) => e.type === 'cost') as Extract<RunEvent, { type: 'cost' }>;
    expect(cost.usd).toBe(0);
    expect(cost.tokensIn).toBeGreaterThan(0);
    expect(kinds.at(-1)).toBe('done');
  });

  it('offers the model only the os tools the role allows', async () => {
    const before = fake.seen.length;
    await collect(runtimeFor('ok').start(await request({ allowedTools: ['mcp__os__get_task', 'Bash'] })));
    const body = JSON.parse(fake.seen.slice(before).find((s) => s.body.includes('tools'))!.body) as { tools: { function: { name: string } }[] };
    expect(body.tools.map((t) => t.function.name)).toEqual(['get_task']);
  });

  it('sends the run token to the os server and its own key only to the model endpoint', async () => {
    const before = fake.seen.length;
    const req = await request();
    const events = await collect(runtimeFor('ok', { apiKey: 'model-key-1' }).start(req));
    expect(JSON.stringify(events)).not.toContain(req.runToken);
    const sent = fake.seen.slice(before);
    expect(sent.every((s) => s.headers.authorization === 'Bearer model-key-1')).toBe(true);
    expect(sent.some((s) => s.body.includes(req.runToken) || JSON.stringify(s.headers).includes(req.runToken))).toBe(false);
    for (const v of Object.values(SECRETS)) expect(sent.some((s) => s.body.includes(v) || JSON.stringify(s.headers).includes(v))).toBe(false);
  });

  it('stops with a turn-limit error when the agent keeps calling tools', async () => {
    const end = (await collect(runtimeFor('turns').start(await request({ maxTurns: 3 })))).at(-1)!;
    expect(end).toMatchObject({ type: 'error', kind: 'max_turns' });
  });

  it('times out a model that never answers', async () => {
    const end = (await collect(runtimeFor('hang').start(await request({ timeoutMs: 600 })))).at(-1)!;
    expect(end).toMatchObject({ type: 'error', kind: 'timeout' });
  }, 15_000);

  it('names the endpoint and what to check when nothing is listening', async () => {
    const rt = createOpenAIAgentsRuntime({ osUrl, baseUrl: 'http://127.0.0.1:9/v1' });
    const end = (await collect(rt.start(await request()))).at(-1)!;
    expect(end).toMatchObject({ type: 'error', kind: 'runtime' });
    expect((end as { message: string }).message).toMatch(/127\.0\.0\.1:9.*cannot be reached.*Ollama/s);
  }, 20_000);

  it('errors clearly for an alias with no endpoint', async () => {
    const rt = createOpenAIAgentsRuntime({ osUrl });
    const end = (await collect(rt.start(await request({ modelAlias: 'writer' })))).at(-1)!;
    expect(end).toMatchObject({ type: 'error', kind: 'config' });
  });

  it('reports health from the endpoint, and why when it is down', async () => {
    expect(await runtimeFor('ok').health()).toEqual({ ok: true });
    const down = await createOpenAIAgentsRuntime({ osUrl, baseUrl: 'http://127.0.0.1:9/v1' }).health();
    expect(down.ok).toBe(false);
    expect(down.detail).toMatch(/cannot be reached/);
  });
});
