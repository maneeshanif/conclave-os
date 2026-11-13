import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { stopEverything } from '../src/harness/kill-switch';
import { executeRun, type LoopDeps } from '../src/harness/loop';
import { MemoryOsStore, type OsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { approvalHooks, createOutreach } from '../src/outreach';
import { mcpRoutes } from '../src/routes/mcp';
import { createCliRuntime } from '../src/runtimes/cli';
import type { System } from '../src/system';
import { LocalApprovalGate } from '../src/workflows/approval-gate';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/**
 * Slice 1 end to end (S1-12, SPEC 18 row 1). One run, on the outbox, with the real run loop, os server, approvals API,
 * gate and email executor. A stand-in for the claude CLI plays the outreach rep, because the model is the one part that
 * cannot be made deterministic; everything that decides what leaves the machine is the real code.
 *
 * Done when: (1) a lead goes from audit to approved email to sent; (2) the kill switch stops everything; (3) an agent
 * told to send an email by any other route fails; (4) an approval decided after a restart still sends exactly once.
 */
const fake = path.join(__dirname, 'fixtures', 'fake-cli.mjs');
const FOOTER = 'Test Co, 12 Main Street, Lahore 54000, Pakistan';
const json = { 'content-type': 'application/json', origin: 'http://localhost:3000' };

let sys: System;
let osServer: ReturnType<typeof serve>;
let companyRoot: string;
let dataDir: string;
const tokens = new RunTokens();
const bus = new Bus();
const gates: LocalApprovalGate[] = [];
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

beforeAll(async () => {
  const real: { store?: OsStore } = {};
  const store = new Proxy({} as OsStore, {
    get: (_t, prop: string) => (...args: unknown[]) => (real.store as unknown as Record<string, (...a: unknown[]) => unknown>)[prop]!(...args),
  });
  await new Promise<void>((r) => {
    osServer = serve({ fetch: new Hono().route('/mcp', mcpRoutes({ tokens, store })).fetch, port: 0, hostname: '127.0.0.1' }, () => r());
  });
  sys = (await testSystem(`http://127.0.0.1:${(osServer.address() as AddressInfo).port}/mcp`)).sys;
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-s1-co-'));
  dataDir = await mkdtemp(path.join(tmpdir(), 'conclave-s1-data-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), `# Test Co\n\nOur first build is $2,500.\n\n## Cold email footer\n${FOOTER}\n`);
  real.store = new DbOsStore(sys.app, undefined, companyRoot, (_w, approvalId) => void currentGate?.requested(approvalId));
}, 240_000);
afterAll(async () => {
  for (const g of gates) g.stop();
  osServer?.close();
  await sys?.close();
});

let currentGate: LocalApprovalGate | undefined;

/** One "server process": its own gate and executors over the shared data folder, like a restart builds anew. */
function boot() {
  const outreach = createOutreach({ pool: sys.app, workspaceId: ws(), dataDir, companyRoot, bus, env: { OUTREACH_FROM: 'Anees <hello@example.test>' } });
  const gate = new LocalApprovalGate({ pool: sys.app, workspaceId: ws(), executors: outreach.executors, bus });
  gates.push(gate);
  currentGate = gate;
  const hooks = approvalHooks(gate);
  // Limit 0: nothing starts, so a request stays in the queue for the kill switch to drop.
  const dispatcher = new LocalDispatcher(async () => ({ status: 'no_task' }), 0);
  const stopped = { dropped: -1 };
  const app = createApp({
    pool: sys.app,
    workspaceId: ws(),
    tokens,
    store: new MemoryOsStore(),
    bus,
    dispatcher,
    onApprovalDecided: hooks.onApprovalDecided,
    onReleaseHeld: hooks.onReleaseHeld,
    onKillSwitch: async (on) => {
      if (on) stopped.dropped = (await stopEverything(dispatcher)).dropped;
    },
  });
  const req = (method: string, p: string, body?: unknown) => app.request(p, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
  return { gate, req, dispatcher, stopped };
}

const outbox = () => readdir(path.join(dataDir, 'outbox')).catch(() => [] as string[]);
const deps = (mode: 'propose' | 'forbidden'): LoopDeps => ({
  pool: sys.app,
  tokens,
  bus,
  runtimes: {
    'claude-cli': createCliRuntime('claude-cli', { command: { command: process.execPath, prefixArgs: [fake, 'claude', mode] } }),
    opencode: createCliRuntime('opencode', { command: { command: process.execPath, prefixArgs: [fake, 'opencode', mode] } }),
  },
  dataDir: sys.dataDir,
  workspaceSlug: sys.workspace.slug,
  templatesRoot: sys.templatesRoot,
  timeoutMs: 30_000,
});

let repId = '';
/** Creates a lead through the API, gives the rep a task to audit and email it, and runs the rep once. */
async function auditAndPropose(s: ReturnType<typeof boot>, name: string, mode: 'propose' | 'forbidden' = 'propose') {
  const lead = (await (await s.req('POST', '/api/leads', { businessName: name, email: `${name.toLowerCase().replace(/\W+/g, '')}@clinic.test`, website: 'https://clinic.test', notes: 'Booking page asks for a phone call first. Verified.' })).json()) as { id: string };
  await sql("update tasks set status = 'cancelled' where assignee_id = $1 and status = 'todo'", [repId]); // a task an earlier step left unrun must not be picked first
  await sql("insert into tasks (workspace_id, assignee_id, title, body, created_by) values ($1, $2, $3, $4, 'founder')", [ws(), repId, `Audit and email ${name}`, `Audit this lead's site and write one email. Lead id: ${lead.id}`]);
  const out = await executeRun(deps(mode), ws(), repId, 'manual');
  return { lead: lead.id, out };
}
const approvalFor = async (lead: string) => (await sql('select id, status from approvals where dedupe_key = $1', [`email:${lead}:1`])).rows[0] as { id: string; status: string } | undefined;
const settle = async (id: string, status: string) => {
  for (let i = 0; i < 100; i++) {
    if ((await sql('select status from approvals where id = $1', [id])).rows[0].status === status) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`approval ${id} never became ${status}`);
};

describe('slice 1 end to end', () => {
  it('(1) a lead goes from audit to approved email to sent', async () => {
    await agentNew(sys, { template: 'outreach-rep', department: 'outreach', id: 'rep', autonomy: 2 });
    repId = (await sql("select id from agents where key = 'rep'")).rows[0].id;
    const s = boot();

    const { lead, out } = await auditAndPropose(s, 'Glow Clinic');
    expect(out.status, JSON.stringify(out)).toBe('succeeded');
    const ap = (await approvalFor(lead))!;
    expect(ap.status).toBe('pending'); // proposed, not sent
    expect(await outbox()).toEqual([]);

    const inbox = (await (await s.req('GET', '/api/approvals?status=pending')).json()) as { id: string; lead: { business_name: string } }[];
    expect(inbox.map((a) => a.lead.business_name)).toContain('Glow Clinic'); // it is in the inbox the founder opens

    expect((await s.req('POST', `/api/approvals/${ap.id}/decide`, { approved: true })).status).toBe(200);
    await settle(ap.id, 'executed');
    expect(await outbox()).toEqual([`${ap.id}.eml`]);
    expect((await sql('select stage from leads where id = $1', [lead])).rows[0].stage).toBe('contacted');
    expect((await sql('select status from outreach_messages where approval_id = $1', [ap.id])).rows[0].status).toBe('sent');
    expect((await s.req('POST', `/api/approvals/${ap.id}/decide`, { approved: true })).status).toBe(409); // a second yes sends nothing
    expect(await outbox()).toHaveLength(1);
  }, 120_000);

  it('(2) the kill switch stops everything', async () => {
    const s = boot();
    const { lead } = await auditAndPropose(s, 'Spa Seven');
    const ap = (await approvalFor(lead))!;

    // Something is queued, then the switch goes on.
    await s.dispatcher.request({ workspaceId: ws(), agentId: repId, trigger: 'manual' });
    expect((await s.req('PATCH', '/api/settings', { killSwitch: true })).status).toBe(200);
    expect(s.stopped.dropped).toBe(1); // the queued run was dropped

    // And while it is on, a run does not start at all.
    const blocked = await auditAndPropose(s, 'Blocked Clinic');
    expect(blocked.out.status).not.toBe('succeeded');
    expect(await approvalFor(blocked.lead)).toBeUndefined();

    // Approved while it is on: held, not sent, and not lost.
    const before = (await outbox()).length;
    await s.req('POST', `/api/approvals/${ap.id}/decide`, { approved: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(await outbox()).toHaveLength(before);
    expect((await sql('select status from approvals where id = $1', [ap.id])).rows[0].status).toBe('approved');

    // Turning it off sends nothing by itself; asking to release does, once.
    await s.req('PATCH', '/api/settings', { killSwitch: false });
    expect(await outbox()).toHaveLength(before);
    expect(await (await s.req('POST', '/api/settings/release-held', {})).json()).toEqual({ released: 1 });
    expect(await outbox()).toHaveLength(before + 1);
    expect(await (await s.req('POST', '/api/settings/release-held', {})).json()).toEqual({ released: 0 });
  }, 120_000);

  it('(3) an agent told to send an email by any other route fails', async () => {
    const s = boot();
    const before = await outbox();
    const approvalsBefore = (await sql('select count(*)::int as n from approvals')).rows[0].n;
    const { lead, out } = await auditAndPropose(s, 'Salon Three', 'forbidden');
    const events = (await sql('select type, data from run_events where run_id = $1 order by id', [(out as { runId: string }).runId])).rows;
    const refusal = events.find((e) => e.type === 'tool_result' && e.data.ok === false);
    expect(JSON.stringify(refusal?.data)).toMatch(/Unknown tool/);
    expect(await approvalFor(lead)).toBeUndefined();
    expect((await sql('select count(*)::int as n from approvals')).rows[0].n).toBe(approvalsBefore);
    expect(await outbox()).toEqual(before);
  }, 120_000);

  it('(4) an approval decided after a restart still sends exactly once', async () => {
    const first = boot();
    const decidedWhileDown = await auditAndPropose(first, 'Clinic Four');
    const pendingAcross = await auditAndPropose(first, 'Clinic Five');
    const a = (await approvalFor(decidedWhileDown.lead))!;
    const b = (await approvalFor(pendingAcross.lead))!;
    const before = await outbox();
    first.gate.stop(); // the process dies with both waiting

    // The founder decides A while the server is down (straight to the record, as a half-finished decision would be).
    await sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [a.id]);

    const second = boot(); // the restart
    const report = await second.gate.recover();
    expect(report.waiting).toContain(b.id); // B is waiting again
    expect(await outbox()).toEqual([...before, `${a.id}.eml`].sort()); // A went out, once
    await second.gate.recover();
    await second.gate.recover();
    expect((await outbox()).filter((f) => f === `${a.id}.eml`)).toHaveLength(1); // starting again finds nothing new to send

    // B is decided after the restart, through the API, and goes out once.
    expect((await second.req('POST', `/api/approvals/${b.id}/decide`, { approved: true })).status).toBe(200);
    await settle(b.id, 'executed');
    expect((await outbox()).filter((f) => f === `${b.id}.eml`)).toHaveLength(1);
    expect((await second.req('POST', `/api/approvals/${b.id}/decide`, { approved: true })).status).toBe(409);
    expect((await sql("select count(*)::int as n from outreach_messages where approval_id = any($1) and status = 'sent'", [[a.id, b.id]])).rows[0].n).toBe(2);
  }, 120_000);
});
