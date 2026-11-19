import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serve as inngestServe } from 'inngest/hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { approvalHooks, createOutreach } from '../src/outreach';
import type { System } from '../src/system';
import { createInngestGate, gateOps } from '../src/workflows/approval-gate';
import { createWorkflows } from '../src/workflows/inngest';
import { testSystem } from './helpers/db';

/**
 * One-off check of the approval gate against a REAL Inngest dev server (S1-3 tested the function with a stand-in for
 * `step` only). Skipped unless CONCLAVE_TEST_INNGEST=1. Start the dev server yourself first, pointing at this test's port:
 *
 *   npx inngest-cli@latest dev -u http://127.0.0.1:3191/inngest
 *
 * then in another terminal, from the repo folder (PowerShell):
 *
 *   $env:CONCLAVE_TEST_INNGEST = '1'; pnpm exec vitest run apps/server/test/real-inngest.test.ts
 *
 * It proposes an email, waits for the gate function to be waiting inside Inngest, approves it through the API, and checks
 * the email reaches the outbox exactly once.
 */
const enabled = process.env.CONCLAVE_TEST_INNGEST === '1';
const PORT = 3191;
const FOOTER = 'Test Co, 12 Main Street, Lahore 54000, Pakistan';

describe.skipIf(!enabled)('the approval gate on a real Inngest dev server (S1-12)', () => {
  let sys: System;
  let server: ReturnType<typeof serve>;
  let dataDir: string;
  let propose: () => Promise<string>;
  let decide: (id: string) => Promise<number>;

  beforeAll(async () => {
    process.env.INNGEST_DEV = '1';
    ({ sys } = await testSystem());
    const ws = sys.workspace.id;
    const companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-inn-co-'));
    dataDir = await mkdtemp(path.join(tmpdir(), 'conclave-inn-data-'));
    await writeFile(path.join(companyRoot, 'COMPANY.md'), `# Test Co\n\n## Cold email footer\n${FOOTER}\n`);
    const bus = new Bus();
    const { executors } = createOutreach({ pool: sys.app, workspaceId: ws, dataDir, companyRoot, bus, env: { OUTREACH_FROM: 'Anees <hello@example.test>' } });
    const wf = createWorkflows({ execute: async () => ({ status: 'no_task' }), tickAll: async () => [], approvals: gateOps({ pool: sys.app, workspaceId: ws, bus, executors }) });
    const gate = createInngestGate({ send: (e) => wf.inngest.send(e), pool: sys.app, workspaceId: ws, bus, executors });
    const hooks = approvalHooks(gate);
    const store = new DbOsStore(sys.app, undefined, companyRoot, hooks.onApprovalRequested);
    const api = createApp({ pool: sys.app, workspaceId: ws, tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: wf.dispatcher, onApprovalDecided: hooks.onApprovalDecided, inngestHandler: inngestServe({ client: wf.inngest, functions: wf.functions }) });
    server = serve({ fetch: new Hono().route('/', api).fetch, port: PORT, hostname: '127.0.0.1' });

    await agentNew(sys, { template: 'outreach-rep', department: 'outreach', id: 'rep', autonomy: 2 });
    const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws, ({ client }) => client.query(q, p));
    const agentId = (await sql("select id from agents where key = 'rep'")).rows[0].id as string;
    propose = async () => {
      const lead = (await sql("insert into leads (workspace_id, business_name, email) values ($1, 'Glow', $2) returning id", [ws, `x${Date.now()}@clinic.test`])).rows[0].id as string;
      const task = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 't', 'in_progress', $2, $2, 'founder') returning id", [ws, agentId])).rows[0].id as string;
      const run = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'claude-cli', 'running') returning id", [ws, agentId, task])).rows[0].id as string;
      await callOsTool(store, { workspaceId: ws, agentId, runId: run, taskId: task }, 'propose_email', { leadId: lead, subject: 'A concept', body: 'Hi, a short note about your booking page.', step: 1 });
      return (await sql('select id from approvals where dedupe_key = $1', [`email:${lead}:1`])).rows[0].id as string;
    };
    decide = async (id) => (await api.request(`/api/approvals/${id}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"approved":true}' })).status;
  }, 240_000);

  afterAll(async () => {
    server?.close();
    await sys?.close();
  });

  it('waits inside Inngest for the decision, then sends exactly once', async () => {
    const id = await propose();
    await new Promise((r) => setTimeout(r, 5_000)); // let the dev server start the function and reach waitForEvent
    expect(await readdir(path.join(dataDir, 'outbox')).catch(() => [])).toEqual([]);
    expect(await decide(id)).toBe(200);
    let files: string[] = [];
    for (let i = 0; i < 60 && files.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 500));
      files = await readdir(path.join(dataDir, 'outbox')).catch(() => []);
    }
    expect(files).toEqual([`${id}.eml`]);
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await readdir(path.join(dataDir, 'outbox'))).toHaveLength(1); // Inngest did not run the executor twice
  }, 120_000);
});
