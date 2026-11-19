import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { MemoryOsStore, callOsTool } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { approvalHooks, createOutreach } from '../src/outreach';
import type { System } from '../src/system';
import { LocalApprovalGate } from '../src/workflows/approval-gate';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

const FOOTER = 'Test Co, 12 Main Street, Lahore 54000, Pakistan';
const companyMd = (footer = FOOTER) => `# Test Co\n\nOur first build is $2,500.\n\n## Cold email footer\n${footer}\n`;

let sys: System;
let companyRoot: string;
let agentId = '';
let runId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const gates: LocalApprovalGate[] = [];

beforeAll(async () => {
  ({ sys } = await testSystem());
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-wire-co-'));
  await agentNew(sys, { template: 'outreach-rep', department: 'outreach', autonomy: 2 });
  agentId = (await sql("select id from agents where key = 'outreach-outreach-rep'")).rows[0].id;
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id;
}, 180_000);
afterAll(async () => {
  for (const g of gates) g.stop();
  await sys?.close();
});
beforeEach(async () => {
  await writeFile(path.join(companyRoot, 'COMPANY.md'), companyMd());
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0, window_hours = 5, window_cap = 100000, email_daily_cap = 100000', [ws()]);
  await sql("update approvals set status = 'failed' where kind = 'email.send' and status in ('approved', 'executing', 'pending')");
});

/** One "server": the same wiring index.ts uses, over a data folder of its own so the outbox is this test's alone. */
async function server(env: Record<string, string | undefined> = { OUTREACH_FROM: 'Anees <hello@example.test>' }) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'conclave-wire-data-'));
  const bus = new Bus();
  const outreach = createOutreach({ pool: sys.app, workspaceId: ws(), dataDir, companyRoot, bus, env });
  const gate = new LocalApprovalGate({ pool: sys.app, workspaceId: ws(), executors: outreach.executors, bus });
  gates.push(gate);
  const hooks = approvalHooks(gate);
  const store = new DbOsStore(sys.app, undefined, companyRoot, hooks.onApprovalRequested);
  const app = createApp({
    pool: sys.app,
    workspaceId: ws(),
    tokens: new RunTokens(),
    store: new MemoryOsStore(),
    bus,
    dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })),
    onApprovalDecided: hooks.onApprovalDecided,
    onReleaseHeld: hooks.onReleaseHeld,
  });
  const outbox = path.join(dataDir, 'outbox');
  const req = (method: string, p: string, body?: unknown) => app.request(p, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    outreach,
    gate,
    hooks,
    outbox,
    req,
    /** An agent at autonomy 2 proposes the email: the only door there is. */
    async propose(over: { subject?: string; body?: string } = {}) {
      const email = `dana-${randomUUID().slice(0, 8)}@clinic.test`;
      const lead = (await sql("insert into leads (workspace_id, business_name, email) values ($1, 'Glow Clinic', $2) returning id", [ws(), email])).rows[0].id as string;
      await callOsTool(store, { workspaceId: ws(), agentId, runId }, 'propose_email', {
        leadId: lead,
        subject: over.subject ?? 'A homepage concept',
        body: over.body ?? 'Hi Dana, I saw your booking page asks for a phone call first. Happy to share a concept.',
        step: 1,
      });
      const approvalId = (await sql('select id from approvals where dedupe_key = $1', [`email:${lead}:1`])).rows[0].id as string;
      return { lead, email, approvalId };
    },
    approve: (id: string, body: Record<string, unknown> = {}) => req('POST', `/api/approvals/${id}/decide`, { approved: true, ...body }),
  };
}
const outboxFiles = async (dir: string) => readdir(dir).catch(() => [] as string[]);
const approvalOf = async (id: string) => (await sql('select status, result from approvals where id = $1', [id])).rows[0] as { status: string; result: { reason?: string } | null };
const items = async (id: string) => (await sql('select kind from action_items where approval_id = $1', [id])).rows.map((r) => r.kind as string);

describe('choosing the transport (S1-7)', () => {
  const make = (env: Record<string, string | undefined>) =>
    createOutreach({ pool: sys.app, workspaceId: ws(), dataDir: path.join(tmpdir(), 'conclave-none'), companyRoot, env });

  it('is the outbox unless the setting says otherwise, and an API key alone changes nothing', () => {
    expect(make({}).transport.name).toBe('outbox');
    expect(make({ RESEND_API_KEY: 'key' }).transport.name).toBe('outbox');
    expect(make({ OUTREACH_TRANSPORT: 'outbox', RESEND_API_KEY: 'key' }).transport.name).toBe('outbox');
  });

  it('needs both settings for a real transport, and refuses to start with half of them', () => {
    expect(make({ OUTREACH_TRANSPORT: 'resend', RESEND_API_KEY: 'key' }).transport.name).toBe('resend');
    expect(() => make({ OUTREACH_TRANSPORT: 'resend' })).toThrow(/needs RESEND_API_KEY/);
  });
});

describe('the whole chain, on the outbox (S1-7)', () => {
  it('a proposal waits, an approval sends it to the outbox exactly once, and everything is recorded', async () => {
    const s = await server();
    const { lead, email, approvalId } = await s.propose();
    // Proposing asked the gate to wait. It does so in the background, so give it a moment.
    for (let i = 0; i < 40 && !s.gate.waiting().includes(approvalId); i++) await new Promise((r) => setTimeout(r, 50));
    expect(s.gate.waiting()).toContain(approvalId);
    expect(await outboxFiles(s.outbox)).toEqual([]); // and nothing has gone anywhere

    expect((await s.approve(approvalId)).status).toBe(200);
    expect(await outboxFiles(s.outbox)).toEqual([`${approvalId}.eml`]);
    const eml = await readFile(path.join(s.outbox, `${approvalId}.eml`), 'utf8');
    expect(eml).toContain(`To: ${email}`);
    expect(eml).toContain('Subject: A homepage concept');
    expect(eml).toContain('From: Anees <hello@example.test>');
    expect(eml).toContain('Happy to share a concept.');
    expect(eml).toContain(FOOTER); // the company footer is added at send time
    expect(eml).toContain('List-Unsubscribe: <mailto:hello@example.test?subject=unsubscribe>');

    expect((await approvalOf(approvalId)).status).toBe('executed');
    expect(s.gate.waiting()).not.toContain(approvalId);
    expect((await sql('select status, external_ref from outreach_messages where approval_id = $1', [approvalId])).rows[0]).toMatchObject({ status: 'sent', external_ref: expect.stringContaining('outbox:') });
    expect((await sql('select stage from leads where id = $1', [lead])).rows[0].stage).toBe('contacted');
    const audit = await sql("select actor, action from audit_log where subject = $1 order by id", [approvalId]);
    expect(audit.rows.map((r) => `${r.actor}:${r.action}`)).toEqual(['founder:approval.decided', 'executor:email:approval.executed']);

    // Approving again, from anywhere, sends nothing more.
    expect((await s.approve(approvalId)).status).toBe(409);
    expect(await outboxFiles(s.outbox)).toHaveLength(1);
  });

  it('writes into this server\'s own data folder and nowhere else', async () => {
    const s = await server();
    const { approvalId } = await s.propose();
    await s.approve(approvalId);
    expect((await stat(s.outbox)).isDirectory()).toBe(true);
    expect(s.outreach.transport.name).toBe('outbox');
  });

  it('a rejected proposal sends nothing', async () => {
    const s = await server();
    const { approvalId } = await s.propose();
    expect((await s.req('POST', `/api/approvals/${approvalId}/decide`, { approved: false })).status).toBe(200);
    expect(await outboxFiles(s.outbox)).toEqual([]);
    expect(s.gate.waiting()).not.toContain(approvalId);
  });
});

describe('what stops a send at the last moment (S1-7)', () => {
  it('refuses, and says why, while the footer still has a placeholder address', async () => {
    const s = await server();
    const { approvalId } = await s.propose();
    await writeFile(path.join(companyRoot, 'COMPANY.md'), companyMd('TODO fill in the address'));
    await s.approve(approvalId);
    expect(await approvalOf(approvalId)).toMatchObject({ status: 'failed', result: { reason: expect.stringMatching(/footer.*placeholder/) } });
    expect(await outboxFiles(s.outbox)).toEqual([]);
    expect(await items(approvalId)).toEqual(['executor_failed']); // a person is told, once
    expect((await sql('select status from outreach_messages where approval_id = $1', [approvalId])).rows[0].status).toBe('refused');
  });

  it('refuses a blocked claim added after the proposal, when the founder edits the card', async () => {
    const s = await server();
    const claim = await s.propose();
    await s.approve(claim.approvalId, { editedPayload: { subject: 'A homepage concept', body: 'We offer guaranteed results for every clinic.' } });
    expect(await approvalOf(claim.approvalId)).toMatchObject({ status: 'failed', result: { reason: expect.stringMatching(/blocked claims.*medical/) } });

    const price = await s.propose();
    await s.approve(price.approvalId, { editedPayload: { subject: 'A homepage concept', body: 'Only $99 this week, no catch.' } });
    expect(await approvalOf(price.approvalId)).toMatchObject({ status: 'failed', result: { reason: expect.stringMatching(/price not in COMPANY\.md/) } });
    expect(await outboxFiles(s.outbox)).toEqual([]);
  });

  it('refuses when there is no sender address, and says which setting to fill in', async () => {
    const s = await server({}); // OUTREACH_FROM is not set
    const { approvalId } = await s.propose();
    await s.approve(approvalId);
    expect(await approvalOf(approvalId)).toMatchObject({ status: 'failed', result: { reason: expect.stringMatching(/OUTREACH_FROM/) } });
    expect(await outboxFiles(s.outbox)).toEqual([]);
  });

  it('a lead suppressed after the proposal gets nothing', async () => {
    const s = await server();
    const { approvalId, email } = await s.propose();
    await s.req('POST', '/api/suppression', { value: email.toUpperCase(), reason: 'Unsubscribed.' });
    await s.approve(approvalId);
    expect((await approvalOf(approvalId)).status).toBe('failed');
    expect(await outboxFiles(s.outbox)).toEqual([]);
  });
});

describe('held approvals and starting up (S1-7)', () => {
  it('holds an approved email while the kill switch is on, and sends it once, on request, after the switch is off', async () => {
    const s = await server();
    const { approvalId } = await s.propose();
    await s.req('PATCH', '/api/settings', { killSwitch: true });
    await s.approve(approvalId);
    expect(await outboxFiles(s.outbox)).toEqual([]);
    expect((await approvalOf(approvalId)).status).toBe('approved'); // held, not lost

    expect((await s.req('POST', '/api/settings/release-held', {})).status).toBe(409); // not while it is on
    await s.req('PATCH', '/api/settings', { killSwitch: false });
    expect(await outboxFiles(s.outbox)).toEqual([]); // turning it off sent nothing by itself

    const released = await s.req('POST', '/api/settings/release-held', {});
    expect(released.status).toBe(200);
    expect(await released.json()).toEqual({ released: 1 });
    expect(await outboxFiles(s.outbox)).toEqual([`${approvalId}.eml`]);
    expect(await (await s.req('POST', '/api/settings/release-held', {})).json()).toEqual({ released: 0 }); // and only once
    expect(await outboxFiles(s.outbox)).toHaveLength(1);
  });

  it('on start, sends what was approved while the server was down, once, and waits again for what is still pending', async () => {
    const before = await server();
    const waiting = await before.propose();
    const decided = await before.propose();
    before.gate.stop(); // the process dies with both waiting
    await sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [decided.approvalId]); // decided while it was down

    const after = await server();
    const report = await after.gate.recover();
    expect(report.waiting).toContain(waiting.approvalId);
    expect(await outboxFiles(after.outbox)).toEqual([`${decided.approvalId}.eml`]);
    await after.gate.recover();
    expect(await outboxFiles(after.outbox)).toHaveLength(1); // a second start finds nothing new to send
  });
});
