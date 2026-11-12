import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
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
 * Runs the real `opencode` binary against a fake model and the real `os` MCP server.
 * Skipped unless CONCLAVE_TEST_OPENCODE points at an opencode binary, because it needs one installed.
 */
const bin = process.env.CONCLAVE_TEST_OPENCODE;
const LLM_PORT = 18099;

describe.skipIf(!bin)('real opencode against the os MCP server', () => {
  let llm: ChildProcess;
  let server: ReturnType<typeof serve>;
  let osUrl = '';
  const tokens = new RunTokens();
  const store = new MemoryOsStore();

  beforeAll(async () => {
    llm = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'fake-llm.mjs'), String(LLM_PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((r) => llm.stdout!.once('data', () => r()));
    const app = new Hono().route('/mcp', mcpRoutes({ tokens, store }));
    await new Promise<void>((r) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => r());
    });
    osUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => {
    llm?.kill();
    server?.close();
  });

  it('calls get_task and complete_task with its run token, and only those tools reach the os server', async () => {
    store.tasks.set('t1', { id: 't1', workspaceId: 'ws', title: 'List five facts', body: 'From COMPANY.md', status: 'in_progress' });
    const t = await loadTemplate(path.join(REPO_ROOT, 'templates'), 'researcher');
    const agent = parseRoleFile(
      renderRoleFile(t, { id: 'r1', name: 'Researcher', department: 'research', department_name: 'Research', company_name: 'Acme', runtime: 'opencode', model: 'any-model' }),
      'x',
    );
    const dataDir = await mkdtemp(path.join(tmpdir(), 'conclave-oc-'));
    const out = await renderWorkdir(agent, { dataDir, workspaceSlug: 'local', companyName: 'Acme', companyMd: 'Acme makes tests.', departmentName: 'Research', osUrl, templatesRoot: path.join(REPO_ROOT, 'templates') });
    // Point this one folder at the fake model. Real installs use the person's own provider.
    const cfgPath = path.join(out.dir, 'opencode.json');
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    cfg.model = 'fake/fake';
    cfg.provider = { fake: { npm: '@ai-sdk/openai-compatible', name: 'Fake', options: { baseURL: `http://127.0.0.1:${LLM_PORT}/v1`, apiKey: 'x' }, models: { fake: { name: 'Fake' } } } };
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2));

    const token = tokens.issue({ workspaceId: 'ws', agentId: 'agent-r1', runId: 'run1', taskId: 't1' });
    const rt = createCliRuntime('opencode', {
      command: { command: bin! },
      baseEnv: { ...process.env, HOME: process.env.CONCLAVE_TEST_OPENCODE_HOME ?? process.env.HOME, SECRET_THING: 'nope' },
    });
    const events: RunEvent[] = [];
    for await (const e of rt.start({ runId: 'run1', workspaceId: 'ws', agentId: 'agent-r1', agentKey: 'r1', taskId: 't1', instructions: 'ctx', taskInput: 'List five facts', workspaceDir: out.dir, modelAlias: 'any-model', maxTurns: 10, runToken: token, timeoutMs: 120_000 })) {
      events.push(e);
    }
    expect(events.at(-1), JSON.stringify(events.slice(-3))).toMatchObject({ type: "done" });
    const calls = events.filter((e) => e.type === 'tool_call').map((e) => (e as { tool: string }).tool);
    expect(calls).toEqual(['os_get_task', 'os_complete_task']);
    expect(events.filter((e) => e.type === 'tool_result').every((e) => (e as { ok: boolean }).ok)).toBe(true);
    expect(store.tasks.get('t1')).toMatchObject({ status: 'done', output: 'Fact 1 (COMPANY.md line 3)' });
    // The template denies a shell, so opencode must not offer one to the model.
    const finalText = events.filter((e) => e.type === 'message').map((e) => (e as { text: string }).text).join('\n');
    expect(finalText).not.toMatch(/\bbash\b/);
    expect(JSON.stringify(events)).not.toContain(token);
  }, 180_000);
});
