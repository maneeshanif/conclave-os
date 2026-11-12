import { mkdtemp } from 'node:fs/promises';
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
import { createCliRuntime, ENV_ALLOWLIST } from '../src/runtimes/cli';
import { conformanceCases, type ConformanceDeps } from '../src/runtimes/conformance';
import type { RunRequest } from '../src/runtimes/types';

const fake = path.join(__dirname, 'fixtures', 'fake-cli.mjs');
const SECRETS = { RESEND_API_KEY: 'sk_live_x', DATABASE_URL: 'postgres://x', ANTHROPIC_API_KEY: 'sk-ant-x', SECRETS_KEY: 'k' };

class Store extends MemoryOsStore {
  taskStatus(id: string) {
    return this.tasks.get(id)?.status;
  }
}

let server: ReturnType<typeof serve>;
let osUrl = '';
const tokens = new RunTokens();
const store = new Store();
let n = 0;

beforeAll(async () => {
  const app = new Hono().route('/mcp', mcpRoutes({ tokens, store }));
  await new Promise<void>((r) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => r());
  });
  osUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(() => server?.close());

function depsFor(flavor: 'claude-cli' | 'opencode', allow?: readonly string[]): ConformanceDeps {
  const alias = flavor === 'claude-cli' ? 'researcher' : 'any-model';
  return {
    make: (mode) =>
      createCliRuntime(flavor, {
        command: { command: process.execPath, prefixArgs: [fake, flavor === 'claude-cli' ? 'claude' : 'opencode', mode] },
        baseEnv: { ...process.env, ...SECRETS },
        ...(allow ? { envAllowlist: allow } : {}),
      }),
    async request(over: Partial<RunRequest> = {}) {
      const t = await loadTemplate(path.join(REPO_ROOT, 'templates'), 'researcher');
      const agent = parseRoleFile(
        renderRoleFile(t, { id: 'r1', name: 'R', department: 'research', department_name: 'Research', company_name: 'Acme', runtime: flavor, model: alias }),
        'x',
      );
      const out = await renderWorkdir(agent, {
        dataDir: await mkdtemp(path.join(tmpdir(), 'conclave-conf-')),
        workspaceSlug: 'local',
        companyName: 'Acme',
        companyMd: 'Acme.',
        departmentName: 'Research',
        osUrl,
        templatesRoot: path.join(REPO_ROOT, 'templates'),
      });
      return {
        runId: `run-${++n}`,
        workspaceId: 'ws',
        agentId: 'agent-r1',
        agentKey: 'r1',
        instructions: 'ctx',
        taskInput: 'List five facts',
        workspaceDir: out.dir,
        modelAlias: alias,
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
      const id = `task-${++n}`;
      store.tasks.set(id, { id, workspaceId, title: 'List five facts', body: null, status: 'in_progress' });
      return id;
    },
  };
}

for (const flavor of ['claude-cli', 'opencode'] as const) {
  describe(`runtime conformance: ${flavor} (S0-7)`, () => {
    for (const c of conformanceCases) {
      it(`${c.point}. ${c.name}`, () => c.run(depsFor(flavor)), 30_000);
    }
  });
}

describe('runtime conformance catches a broken runtime (S0-7)', () => {
  it('fails point 4 with a message naming the leaked variable', async () => {
    const broken = depsFor('claude-cli', [...ENV_ALLOWLIST, 'RESEND_API_KEY']);
    const point4 = conformanceCases.find((c) => c.point === 4)!;
    await expect(point4.run(broken)).rejects.toThrow(/RESEND_API_KEY/);
  });
});
