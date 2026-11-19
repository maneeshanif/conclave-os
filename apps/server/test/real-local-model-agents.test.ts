import type { AddressInfo } from 'node:net';
import { freemem } from 'node:os';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { mcpRoutes } from '../src/routes/mcp';
import { createOpenAIAgentsRuntime } from '../src/runtimes/openai-agents';
import type { RunEvent } from '../src/runtimes/types';

/**
 * Does a real local model work through the in-process `openai-agents` runtime (S4-9)? It calls the real Ollama endpoint and
 * the real `os` MCP server with a run token, and checks what a real model can show: it calls get_task then complete_task, both
 * succeed, the task ends done with an answer that uses what the task said, nothing but the `os` tools is called, and the run
 * token never appears.
 *
 * Skipped unless CONCLAVE_TEST_OLLAMA is set to the Ollama model name, for example gemma4:latest. A model of about 7 GB needs
 * about 8 GB of free memory; when it is short the test FAILS with that message instead of loading the model, because loading
 * it anyway makes the machine swap and stalls everything else. Run it with the browser and editors closed:
 *
 *   $env:CONCLAVE_TEST_OLLAMA='gemma4:latest'; pnpm exec vitest run apps/server/test/real-local-model-agents.test.ts
 */
const model = process.env.CONCLAVE_TEST_OLLAMA;
const OLLAMA = process.env.OLLAMA_HOST_URL ?? 'http://127.0.0.1:11434';
const NEEDED_FREE_GB = Number(process.env.CONCLAVE_TEST_LOCAL_MODEL_FREE_GB ?? 8);

describe.skipIf(!model)('a real local model through the openai-agents runtime', () => {
  let server: ReturnType<typeof serve>;
  let osUrl = '';
  const tokens = new RunTokens();
  const store = new MemoryOsStore();

  beforeAll(async () => {
    const app = new Hono().route('/mcp', mcpRoutes({ tokens, store }));
    await new Promise<void>((r) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => r());
    });
    osUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(async () => {
    server?.close();
    // Give the memory back now instead of leaving the model loaded for Ollama's five-minute default.
    if (model) await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => undefined);
  });

  it('has the memory to load the model', () => {
    const freeGb = freemem() / 1024 ** 3;
    expect(freeGb, `Only ${freeGb.toFixed(1)} GB of RAM is free and ${model} needs about ${NEEDED_FREE_GB} GB. Close Chrome and VS Code, then run this again.`).toBeGreaterThanOrEqual(NEEDED_FREE_GB);
  });

  it('is reachable, and health says so', async () => {
    expect(await createOpenAIAgentsRuntime({ osUrl, baseUrl: `${OLLAMA}/v1`, model }).health()).toEqual({ ok: true });
  });

  it('calls get_task then complete_task with its run token, finishes the task with an answer, and calls nothing else', async () => {
    store.tasks.set('t1', {
      id: 't1',
      workspaceId: 'ws',
      title: 'List three facts from the company file',
      body: 'The company file:\n1: # Acme\n2: Acme builds websites for small businesses.\n3: Acme is based in Lahore and was founded in 2024.',
      status: 'in_progress',
    });
    const token = tokens.issue({ workspaceId: 'ws', agentId: 'agent-r1', runId: 'run1', taskId: 't1' });
    const rt = createOpenAIAgentsRuntime({ osUrl, baseUrl: `${OLLAMA}/v1`, model });
    const events: RunEvent[] = [];
    for await (const e of rt.start({
      runId: 'run1',
      workspaceId: 'ws',
      agentId: 'agent-r1',
      agentKey: 'r1',
      taskId: 't1',
      instructions: 'You are a researcher. Read your task with get_task, do it, and finish it with complete_task. Use only the tools you have.',
      taskInput: 'List three facts from the company file, each with its line number.',
      workspaceDir: process.cwd(),
      modelAlias: 'local-worker',
      maxTurns: 12,
      runToken: token,
      timeoutMs: 600_000,
    })) {
      events.push(e);
    }

    expect(events.at(-1), JSON.stringify(events.slice(-3))).toMatchObject({ type: 'done' });
    const calls = events.filter((e) => e.type === 'tool_call').map((e) => (e as { tool: string }).tool);
    expect(calls.indexOf('get_task'), `tool calls: ${calls.join(', ')}`).toBeGreaterThanOrEqual(0);
    expect(calls.at(-1)).toBe('complete_task');
    expect(calls.every((c) => ['get_task', 'comment', 'complete_task', 'block_task', 'ask_founder'].includes(c)), `tool calls: ${calls.join(', ')}`).toBe(true);
    expect(events.filter((e) => e.type === 'tool_result').every((e) => (e as { ok: boolean }).ok)).toBe(true);
    const task = store.tasks.get('t1') as { status: string; output?: string };
    expect(task.status).toBe('done');
    expect(task.output ?? '', 'the answer').toMatch(/Acme|Lahore|2024|websites/i);
    expect(JSON.stringify(events)).not.toContain(token);
  }, 700_000);
});
