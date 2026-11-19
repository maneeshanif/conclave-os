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
import { createClaudeAgentRuntime, loadAgentSdk, type SdkMessage, type SdkQuery } from '../src/runtimes/claude-agent';
import { conformanceCases, type ConformanceDeps } from '../src/runtimes/conformance';
import type { RunEvent, RunRequest } from '../src/runtimes/types';

const SECRETS = { RESEND_API_KEY: 'sk_live_resend_x', DATABASE_URL: 'postgres://secret-db', SECRETS_KEY: 'secret-key-x', OPENAI_API_KEY: 'sk-env-openai' };
const KEY = 'sk-ant-the-persons-own-key';

class Store extends MemoryOsStore {
  taskStatus(id: string) {
    return this.tasks.get(id)?.status;
  }
}

let osServer: ReturnType<typeof serve>;
let osUrl = '';
let work = '';
const tokens = new RunTokens();
const store = new Store();
const seen: Record<string, unknown>[] = [];
let n = 0;
const saved: Record<string, string | undefined> = {};

/** A scripted SDK: yields the messages the real one would, in the shape the docs give. */
function scripted(mode: string): SdkQuery {
  return async function* ({ options }): AsyncGenerator<SdkMessage> {
    seen.push(options);
    const sid = 'sdk-session-1';
    yield { type: 'system', subtype: 'init', session_id: sid, tools: [] };
    const os = (options.mcpServers as { os: { url: string; headers: { Authorization: string } } }).os;
    const call = async (i: number, tool: string, input: unknown): Promise<SdkMessage[]> => {
      const res = await fetch(os.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: os.headers.Authorization }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: input } }) });
      const j = res.status === 200 ? ((await res.json()) as { result?: { isError?: boolean; content?: { text?: string }[] } }) : null;
      return [
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${i}`, name: `mcp__os__${tool}`, input }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: j?.result?.content?.[0]?.text ?? `HTTP ${res.status}`, is_error: !j || Boolean(j.result?.isError) }] } },
      ];
    };
    if (mode === 'hang') await new Promise((_r, rej) => (options.abortController as AbortController).signal.addEventListener('abort', () => rej(new Error('aborted'))));
    if (mode === 'mcp') for (const [i, [t, a]] of ([['get_task', {}], ['complete_task', { output: 'Five facts.' }]] as [string, unknown][]).entries()) for (const m of await call(i, t, a)) yield m;
    if (mode === 'forbidden') for (const m of await call(0, 'send_email', { to: 'x@y.z' })) yield m;
    const text = mode === 'env' ? JSON.stringify({ keys: Object.keys(options.env as object).sort(), args: options.resume ? [options.resume] : [] }) : 'All done.';
    yield { type: 'assistant', message: { content: [{ type: 'text', text }] } };
    if (mode === 'limit') yield { type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1794500000', session_id: sid, usage: {} };
    else if (mode === 'auth') yield { type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', session_id: sid, usage: {} };
    else yield { type: 'result', subtype: 'success', is_error: false, result: text, session_id: sid, total_cost_usd: 0.02, usage: { input_tokens: 50, output_tokens: 10 } };
  };
}

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
  work = await mkdtemp(path.join(tmpdir(), 'conclave-ca-'));
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  osServer?.close();
  await rm(work, { recursive: true, force: true });
});

const runtimeFor = (mode: string, apiKey: string | undefined = KEY) => createClaudeAgentRuntime({ osUrl, ...(apiKey ? { apiKey } : {}), query: scripted(mode) });

function deps(): ConformanceDeps {
  return {
    make: (mode) => runtimeFor(mode),
    async request(over: Partial<RunRequest> = {}) {
      return { runId: `run-ca-${++n}`, workspaceId: 'ws', agentId: 'agent-ca', agentKey: 'writer', instructions: 'Use the os tools.', taskInput: 'List five facts', workspaceDir: work, modelAlias: 'strong-writer', maxTurns: 10, runToken: '', timeoutMs: 20_000, ...over };
    },
    tokens,
    store,
    secretNames: Object.keys(SECRETS),
    newTask(workspaceId) {
      const id = `task-ca-${++n}`;
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

describe('runtime conformance: claude-agent (S9-2)', () => {
  for (const c of conformanceCases) {
    it(`${c.point}. ${c.name}`, () => c.run(deps()), 30_000);
  }
});

describe('the claude-agent runtime in detail (S9-2)', () => {
  it('is refused with a plain message when there is no API key, and the SDK is never called', async () => {
    const before = seen.length;
    const events = await collect(runtimeFor('ok', '').start(await request()));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', kind: 'auth', message: expect.stringMatching(/API key/) });
    expect(seen.length).toBe(before);
    expect(await runtimeFor('ok', '').health()).toMatchObject({ ok: false });
  });

  it('gives the SDK a hermetic setup: no settings files, the os server with the run token, the granted tools, and a clean environment with only the key', async () => {
    const before = seen.length;
    const req = await request({ allowedTools: ['mcp__os__get_task'], deniedTools: ['Bash'], sessionId: 'resume-1', workDir: '/tmp/work' });
    await collect(runtimeFor('ok').start(req));
    const o = seen[before]! as Record<string, unknown>;
    expect(o).toMatchObject({ settingSources: [], permissionMode: 'dontAsk', allowedTools: ['mcp__os__get_task'], disallowedTools: ['Bash'], resume: 'resume-1', maxTurns: 10 });
    expect((o.mcpServers as { os: { url: string; headers: { Authorization: string } } }).os).toMatchObject({ type: 'http', url: osUrl, headers: { Authorization: `Bearer ${req.runToken}` } });
    const env = o.env as Record<string, string>;
    expect(Object.keys(env).sort()).toEqual(['ANTHROPIC_API_KEY', 'CONCLAVE_RUN_TOKEN', 'HOME', 'PATH']);
    expect(env.ANTHROPIC_API_KEY).toBe(KEY);
    for (const v of Object.values(SECRETS)) expect(JSON.stringify(o).includes(v)).toBe(false);
  });

  it('never lets the key or the run token into the stored events', async () => {
    const req = await request();
    const events = await collect(runtimeFor('mcp').start(req));
    expect(JSON.stringify(events)).not.toContain(req.runToken);
    expect(JSON.stringify(events)).not.toContain(KEY);
    expect(events.find((e) => e.type === 'cost')).toMatchObject({ usd: 0.02, tokensIn: 50, tokensOut: 10 });
  });

  it('says plainly when the SDK package is not installed here', async () => {
    const rt = createClaudeAgentRuntime({ osUrl, apiKey: KEY });
    if ((await loadAgentSdk()) === null) {
      const events = await collect(rt.start(await request()));
      expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'config', message: expect.stringMatching(/not installed/) });
    }
  });
});
