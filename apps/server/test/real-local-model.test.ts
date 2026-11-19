import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { freemem, tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRoleFile } from '../src/company/loader';
import { MemoryOsStore } from '../src/harness/os-tools';
import { loadTemplate, renderRoleFile, renderWorkdir } from '../src/harness/render';
import { RunTokens } from '../src/harness/run-tokens';
import { REPO_ROOT } from '../src/paths';
import { mcpRoutes } from '../src/routes/mcp';
import { createCliRuntime } from '../src/runtimes/cli';
import type { RunEvent } from '../src/runtimes/types';

/**
 * Does a real local model qualify for `local-worker`? It qualifies only if it can call the `os` tools through a
 * runtime (DECISIONS.md: no model is named for `local-worker` before it passes this). Claiming `tools` in its
 * description proves nothing; this runs the real thing.
 *
 * It starts the real `opencode` binary against a real Ollama model and the real `os` MCP server, with a run token,
 * and checks what the conformance suite checks that a real model can show: it calls get_task then complete_task,
 * both succeed, the task ends done with a real answer, no shell is ever called, and the token never appears.
 *
 * Skipped unless BOTH are set:
 *   CONCLAVE_TEST_OPENCODE      path to the opencode binary
 *   CONCLAVE_TEST_LOCAL_MODEL   the Ollama model name, for example gemma4:latest
 *
 * A model of about 7 GB needs about 8 GB free to load. This machine has 16 GB and a 2 GB GPU, so it runs on the
 * CPU. When free memory is short the test FAILS with that message instead of loading the model, because loading
 * it anyway makes the machine swap and makes Claude Code stop background work.
 */
const bin = process.env.CONCLAVE_TEST_OPENCODE;
const model = process.env.CONCLAVE_TEST_LOCAL_MODEL;
const OLLAMA = process.env.OLLAMA_HOST_URL ?? 'http://127.0.0.1:11434';
const NEEDED_FREE_GB = Number(process.env.CONCLAVE_TEST_LOCAL_MODEL_FREE_GB ?? 8);

describe.skipIf(!bin || !model)('a real local model through the opencode runtime', () => {
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
    // Give the memory back: unload the model now instead of leaving it for Ollama's five-minute default.
    if (model) await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => undefined);
  });

  it('has the memory to load the model', () => {
    const freeGb = freemem() / 1024 ** 3;
    expect(freeGb, `Only ${freeGb.toFixed(1)} GB of RAM is free and ${model} needs about ${NEEDED_FREE_GB} GB. Close Chrome and VS Code, then run this again.`).toBeGreaterThanOrEqual(NEEDED_FREE_GB);
  });

  it('calls get_task then complete_task with its run token, finishes the task with an answer, and never calls a shell', async () => {
    store.tasks.set('t1', {
      id: 't1',
      workspaceId: 'ws',
      title: 'List three facts from the company file',
      body: 'The company file:\n1: # Acme\n2: Acme builds websites for small businesses.\n3: Acme is based in Lahore and was founded in 2024.',
      status: 'in_progress',
    });
    const t = await loadTemplate(path.join(REPO_ROOT, 'templates'), 'researcher');
    const agent = parseRoleFile(
      renderRoleFile(t, { id: 'r1', name: 'Researcher', department: 'research', department_name: 'Research', company_name: 'Acme', runtime: 'opencode', model: 'any-model' }),
      'x',
    );
    const dataDir = await mkdtemp(path.join(tmpdir(), 'conclave-local-'));
    const out = await renderWorkdir(agent, { dataDir, workspaceSlug: 'local', companyName: 'Acme', companyMd: 'Acme builds websites.', departmentName: 'Research', osUrl, templatesRoot: path.join(REPO_ROOT, 'templates') });

    // Point this one folder at the local model through Ollama's OpenAI-compatible endpoint.
    const cfgPath = path.join(out.dir, 'opencode.json');
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    cfg.model = `ollama/${model}`;
    cfg.provider = { ollama: { npm: '@ai-sdk/openai-compatible', name: 'Ollama', options: { baseURL: `${OLLAMA}/v1`, apiKey: 'ollama' }, models: { [model!]: { name: model } } } };
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2));

    const token = tokens.issue({ workspaceId: 'ws', agentId: 'agent-r1', runId: 'run1', taskId: 't1' });
    const rt = createCliRuntime('opencode', {
      command: { command: bin! },
      baseEnv: { ...process.env, HOME: process.env.CONCLAVE_TEST_OPENCODE_HOME ?? process.env.HOME, SECRET_THING: 'nope' },
    });
    const events: RunEvent[] = [];
    for await (const e of rt.start({ runId: 'run1', workspaceId: 'ws', agentId: 'agent-r1', agentKey: 'r1', taskId: 't1', instructions: 'ctx', taskInput: 'List three facts from the company file, each with its line number.', workspaceDir: out.dir, modelAlias: 'any-model', maxTurns: 12, runToken: token, timeoutMs: 600_000 })) {
      events.push(e);
    }

    expect(events.at(-1), JSON.stringify(events.slice(-3))).toMatchObject({ type: 'done' });
    const calls = events.filter((e) => e.type === 'tool_call').map((e) => (e as { tool: string }).tool);
    // Tool calling works: it read its task, and the last thing it did was complete it.
    expect(calls.indexOf('os_get_task'), `tool calls: ${calls.join(', ')}`).toBeGreaterThanOrEqual(0);
    expect(calls.at(-1)).toBe('os_complete_task');
    expect(calls.indexOf('os_get_task')).toBeLessThan(calls.lastIndexOf('os_complete_task'));
    // Nothing but the os tools was ever called: no shell, no file writes.
    expect(calls.every((c) => c.startsWith('os_')), `tool calls: ${calls.join(', ')}`).toBe(true);
    expect(events.filter((e) => e.type === 'tool_result').every((e) => (e as { ok: boolean }).ok)).toBe(true);
    // The task is done with a real answer that uses what the task said.
    const task = store.tasks.get('t1') as { status: string; output?: string };
    expect(task.status).toBe('done');
    expect(task.output ?? '', 'the answer').toMatch(/Acme|Lahore|2024|websites/i);
    expect(JSON.stringify(events)).not.toContain(token);
  }, 700_000);
});
