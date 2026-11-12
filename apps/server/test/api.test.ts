import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { MemoryOsStore } from '../src/harness/os-tools';
import { executeRun } from '../src/harness/loop';
import { RunTokens } from '../src/harness/run-tokens';
import { createCliRuntime } from '../src/runtimes/cli';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

const fake = path.join(__dirname, 'fixtures', 'fake-cli.mjs');
let sys: System;
let app: ReturnType<typeof createApp>;
let dispatcher: LocalDispatcher;
let agentId = '';

beforeAll(async () => {
  sys = (await testSystem()).sys;
  await agentNew(sys, { template: 'researcher', department: 'research' });
  const bus = new Bus();
  const tokens = new RunTokens();
  const runtime = createCliRuntime('claude-cli', { command: { command: process.execPath, prefixArgs: [fake, 'claude', 'ok'] } });
  dispatcher = new LocalDispatcher((e) =>
    executeRun({ pool: sys.app, tokens, bus, runtimes: { 'claude-cli': runtime }, dataDir: sys.dataDir, workspaceSlug: 'local', templatesRoot: sys.templatesRoot }, e.workspaceId, e.agentId, e.trigger),
  );
  app = createApp({ pool: sys.app, workspaceId: sys.workspace.id, tokens, store: new MemoryOsStore(), bus, dispatcher });
  const agents = (await (await app.request('/api/agents')).json()) as { id: string; key: string }[];
  agentId = agents.find((a) => a.key === 'research-researcher')!.id;
}, 180_000);
afterAll(async () => sys?.close());

const post = (p: string, body: unknown) => app.request(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('API (S0-8, S0-9)', () => {
  it('creating an assigned task starts a run only after the task is committed, and the task ends done', async () => {
    const res = await post('/api/tasks', { title: 'List five facts', assigneeId: agentId });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await dispatcher.idle();
    const detail = (await (await app.request(`/api/tasks/${id}`)).json()) as { task: { status: string }; thread: { body: string }[]; runs: { id: string; status: string }[] };
    expect(detail.task.status).toBe('done');
    expect(detail.thread.map((m) => m.body)).toEqual(['All done.']);
    expect(detail.runs.map((r) => r.status)).toEqual(['succeeded']);
    const run = (await (await app.request(`/api/runs/${detail.runs[0]!.id}`)).json()) as { events: { type: string }[] };
    expect(run.events.map((e) => e.type)).toEqual(['session', 'tool_call', 'tool_result', 'message', 'cost', 'done']);
  });

  it('validates input and ids', async () => {
    expect((await post('/api/tasks', { title: '' })).status).toBe(400);
    expect((await post('/api/tasks', { title: 'x', assigneeId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await app.request('/api/tasks/not-a-uuid')).status).toBe(404);
    expect((await app.request('/api/runs/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('only the local web app may call the API from a browser', async () => {
    const ok = await app.request('/api/tasks', { headers: { origin: 'http://127.0.0.1:3000' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3000');
    const evil = await app.request('/api/tasks', { headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
});
