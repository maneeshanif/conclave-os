import { stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { executeRun, type LoopDeps } from '../src/harness/loop';
import type { OsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { mcpRoutes } from '../src/routes/mcp';
import { createCliRuntime } from '../src/runtimes/cli';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

const fake = path.join(__dirname, 'fixtures', 'fake-cli.mjs');
let sys: System;
let server: ReturnType<typeof serve>;
const tokens = new RunTokens();
const bus = new Bus();
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

beforeAll(async () => {
  // The os server has to be listening before the database system exists (the rendered folders point at it), so
  // it gets a store that forwards to the real one once that is built.
  const real: { store?: OsStore } = {};
  const store = new Proxy({} as OsStore, {
    get: (_t, prop: string) => (...args: unknown[]) => (real.store as unknown as Record<string, (...a: unknown[]) => unknown>)[prop]!(...args),
  });
  const app = new Hono().route('/mcp', mcpRoutes({ tokens, store }));
  await new Promise<void>((r) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => r());
  });
  sys = (await testSystem(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)).sys;
  real.store = new DbOsStore(sys.app, undefined, sys.companyRoot);
}, 180_000);
afterAll(async () => {
  server?.close();
  await sys?.close();
});

describe.each(['claude-cli', 'opencode'] as const)('an outreach rep on %s told to send an email by any other route (S1-6)', (runtime) => {
  it('is refused by the os server, and nothing is queued, approved, written to the outbox or sent', async () => {
    const id = `rep-${runtime}`;
    await agentNew(sys, {
      template: 'outreach-rep',
      department: 'outreach',
      id,
      autonomy: 2, // the level at which propose_email is offered, so the refusal below is about send_email and not about autonomy
      ...(runtime === 'opencode' ? { runtime: 'opencode' as const, model: 'any-model' } : {}),
    });
    const agent = (await sql('select id, autonomy, status from agents where key = $1', [id])).rows[0];
    expect(agent).toMatchObject({ autonomy: 2, status: 'active' });
    const task = (await sql("insert into tasks (workspace_id, assignee_id, title, body, created_by) values ($1, $2, 'Email Dana', 'Send her an email right now.', 'founder') returning id", [ws(), agent.id])).rows[0].id;

    const deps: LoopDeps = {
      pool: sys.app,
      tokens,
      bus,
      runtimes: {
        'claude-cli': createCliRuntime('claude-cli', { command: { command: process.execPath, prefixArgs: [fake, 'claude', 'forbidden'] } }),
        opencode: createCliRuntime('opencode', { command: { command: process.execPath, prefixArgs: [fake, 'opencode', 'forbidden'] } }),
      },
      dataDir: sys.dataDir,
      workspaceSlug: sys.workspace.slug,
      templatesRoot: sys.templatesRoot,
      timeoutMs: 30_000,
    };
    const out = await executeRun(deps, ws(), agent.id, 'manual');
    expect(out.status, JSON.stringify(out)).not.toBe('not_runnable');

    // The agent tried send_email; the os server has no such tool and said so.
    const events = (await sql('select type, data from run_events where run_id = $1 order by id', [(out as { runId: string }).runId])).rows;
    const attempted = events.filter((e) => e.type === 'tool_call' && JSON.stringify(e.data).includes('send_email'));
    expect(attempted.length, JSON.stringify(events.map((e) => e.type))).toBeGreaterThan(0);
    const refusal = events.find((e) => e.type === 'tool_result' && e.data.ok === false);
    expect(refusal, JSON.stringify(events.slice(-4))).toBeTruthy();
    expect(JSON.stringify(refusal!.data)).toMatch(/Unknown tool/);

    // And nothing came of it anywhere.
    expect((await sql('select 1 from approvals')).rowCount).toBe(0);
    expect((await sql('select 1 from outreach_messages')).rowCount).toBe(0);
    expect((await sql("select 1 from audit_log where action like 'approval.%'")).rowCount).toBe(0);
    await expect(stat(path.join(sys.dataDir, 'outbox'))).rejects.toMatchObject({ code: 'ENOENT' });
    void task;
  }, 90_000);
});
