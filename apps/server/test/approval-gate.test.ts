import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutors } from '../src/actions';
import type { EmailTransport, OutgoingEmail } from '../src/actions/transport';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { approvalGateHandler, createInngestGate, DECISION_TIMEOUT_MS, LocalApprovalGate, type GateOps, type GateStep } from '../src/workflows/approval-gate';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { createWorkflows } from '../src/workflows/inngest';
import { testSystem } from './helpers/db';

class CountingTransport implements EmailTransport {
  name = 'counting';
  sent: OutgoingEmail[] = [];
  async send(m: OutgoingEmail) {
    this.sent.push(m);
    return { ref: `counting:${m.id}` };
  }
}

const COMPANY_MD = '# Co\n\n## Cold email footer\nCo, 12 Main Street, Lahore 54000\n';
let sys: System;
let companyRoot: string;
let transport: CountingTransport;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const gates: LocalApprovalGate[] = [];

beforeAll(async () => {
  ({ sys } = await testSystem());
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-gate-co-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), COMPANY_MD);
}, 180_000);
afterAll(async () => {
  for (const g of gates) g.stop();
  await sys?.close();
});
beforeEach(async () => {
  transport = new CountingTransport();
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0, email_daily_cap = 1000', [ws()]);
});

/** One "server process": its own executors and gate, over the same database. */
function process_(over: { timeoutMs?: number; bus?: Bus; onError?: (e: unknown) => void; executors?: { run(id: string): Promise<unknown>; recover(): Promise<{ resumed: string[]; unknown: string[] }> } } = {}) {
  const executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport, companyRoot, from: 'Anees <hello@example.test>' });
  const gate = new LocalApprovalGate({ pool: sys.app, workspaceId: ws(), executors: over.executors ?? executors, timeoutMs: over.timeoutMs, bus: over.bus, onError: over.onError });
  gates.push(gate);
  const app = createApp({
    pool: sys.app,
    workspaceId: ws(),
    tokens: new RunTokens(),
    store: new MemoryOsStore(),
    bus: over.bus ?? new Bus(),
    dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })),
    onApprovalDecided: (d) => gate.decided(d),
  });
  const decide = (id: string, approved: boolean) => app.request(`/api/approvals/${id}/decide`, { method: 'POST', headers: json, body: JSON.stringify({ approved }) });
  return { gate, app, decide };
}

async function newApproval(over: { status?: string; ageMs?: number } = {}) {
  const email = `dana-${randomUUID().slice(0, 8)}@clinic.test`;
  const lead = (await sql("insert into leads (workspace_id, business_name, email) values ($1, 'Clinic', $2) returning id", [ws(), email])).rows[0].id as string;
  const payload = { leadId: lead, to: email, subject: 'A homepage concept', body: 'Hi Dana, I saw your booking page.', step: 1 };
  const id = (
    await sql(
      `insert into approvals (workspace_id, kind, dedupe_key, payload, status, created_at, decided_at)
       values ($1, 'email.send', $2, $3, $4, now() - ($5 || ' milliseconds')::interval, case when $4 <> 'pending' then now() end) returning id`,
      [ws(), `g:${randomUUID()}`, JSON.stringify(payload), over.status ?? 'pending', String(over.ageMs ?? 0)],
    )
  ).rows[0].id as string;
  await sql("insert into outreach_messages (workspace_id, lead_id, approval_id, to_address, subject, body, status) values ($1, $2, $3, $4, 's', 'b', 'queued')", [ws(), lead, id, email]);
  return { id, email };
}
const statusOf = async (id: string) => (await sql('select status from approvals where id = $1', [id])).rows[0].status as string;
const sentFor = (id: string) => transport.sent.filter((m) => m.id === id).length;
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the approval gate, in process (S1-3)', () => {
  it('an approval decided after a restart sends exactly once', async () => {
    const a = await newApproval();
    const before = process_();
    await before.gate.requested(a.id); // the proposal is made and the server starts waiting...
    before.gate.stop(); // ...and the process dies. Its in-memory wait is gone.

    const after = process_(); // a new process over the same database
    const report = await after.gate.recover();
    expect(report.waiting).toContain(a.id);
    expect(after.gate.waiting()).toContain(a.id);

    expect((await after.decide(a.id, true)).status).toBe(200);
    expect(sentFor(a.id)).toBe(1);
    expect(await statusOf(a.id)).toBe('executed');
    expect(after.gate.waiting()).not.toContain(a.id);
  });

  it('sends an email that was approved while the server was down, once, however many times recovery runs', async () => {
    const a = await newApproval({ status: 'approved' }); // decided in the database, no gate was running
    const p = process_();
    await p.gate.recover();
    await p.gate.recover();
    expect(sentFor(a.id)).toBe(1);
    expect(await statusOf(a.id)).toBe('executed');
  });

  it('two processes hearing the same decision send once: the claim in the database decides', async () => {
    const a = await newApproval({ status: 'approved' });
    const old = process_();
    const fresh = process_();
    const d = { workspaceId: ws(), approvalId: a.id, approved: true };
    await Promise.all([old.gate.decided(d), fresh.gate.decided(d), old.gate.decided(d)]);
    expect(sentFor(a.id)).toBe(1);
  });

  it('picks up a pending approval left over from before a restart and keeps waiting for it', async () => {
    const a = await newApproval();
    const p = process_();
    expect((await p.gate.recover()).waiting).toContain(a.id);
    expect(p.gate.waiting()).toContain(a.id);
    expect(sentFor(a.id)).toBe(0); // waiting is not sending
    expect(await statusOf(a.id)).toBe('pending');
  });

  it('expires a pending approval that is older than three days when the server starts, and it never sends', async () => {
    const a = await newApproval({ ageMs: DECISION_TIMEOUT_MS + 60_000 });
    const p = process_();
    const report = await p.gate.recover();
    expect(report.expired).toContain(a.id);
    expect(report.waiting).not.toContain(a.id);
    expect(await statusOf(a.id)).toBe('expired');
    expect((await sql('select status from outreach_messages where approval_id = $1', [a.id])).rows[0].status).toBe('expired');
    expect((await p.decide(a.id, true)).status).toBe(409); // too late
    expect(sentFor(a.id)).toBe(0);
  });

  it('keeps the time already spent waiting: an approval two days old has one day left', async () => {
    const a = await newApproval({ ageMs: 2 * 24 * 3600_000 });
    const p = process_();
    expect((await p.gate.recover()).waiting).toContain(a.id);
    expect(p.gate.remainingMs(a.id)).toBeLessThanOrEqual(24 * 3600_000);
    expect(p.gate.remainingMs(a.id)).toBeGreaterThan(24 * 3600_000 - 60_000);
  });

  it('expires on its own when nobody decides in time, tells the inbox, and a late decision sends nothing', async () => {
    const bus = new Bus();
    const heard: BusMessage[] = [];
    bus.subscribe((m) => heard.push(m));
    const a = await newApproval();
    const p = process_({ timeoutMs: 150, bus });
    await p.gate.requested(a.id);
    expect(p.gate.waiting()).toContain(a.id);
    await tick(600);
    expect(await statusOf(a.id)).toBe('expired');
    expect(p.gate.waiting()).not.toContain(a.id);
    expect(heard).toContainEqual({ kind: 'approval.changed', workspaceId: ws(), approvalId: a.id, status: 'expired' });
    await p.gate.decided({ workspaceId: ws(), approvalId: a.id, approved: true }); // even if a decision is delivered anyway
    expect(sentFor(a.id)).toBe(0);
  });

  it('a rejection ends the wait and sends nothing', async () => {
    const a = await newApproval();
    const p = process_();
    await p.gate.requested(a.id);
    expect((await p.decide(a.id, false)).status).toBe(200);
    expect(p.gate.waiting()).not.toContain(a.id);
    expect(await statusOf(a.id)).toBe('rejected');
    expect(sentFor(a.id)).toBe(0);
  });

  it('waits once per approval however many times it is asked, and not at all for one already decided', async () => {
    const pending = await newApproval();
    const decided = await newApproval({ status: 'approved' });
    const p = process_();
    await p.gate.requested(pending.id);
    await p.gate.requested(pending.id);
    await p.gate.requested(decided.id);
    expect(p.gate.waiting().filter((id) => id === pending.id)).toHaveLength(1);
    expect(p.gate.waiting()).not.toContain(decided.id);
  });

  it('never retries the execute step: an executor that fails is called once, and the decision still stands', async () => {
    const a = await newApproval({ status: 'approved' });
    let calls = 0;
    const errors: unknown[] = [];
    const p = process_({
      onError: (e) => errors.push(e),
      executors: {
        run: async () => {
          calls++;
          throw new Error('database went away');
        },
        recover: async () => ({ resumed: [], unknown: [] }),
      },
    });
    await expect(p.gate.decided({ workspaceId: ws(), approvalId: a.id, approved: true })).resolves.toBeUndefined(); // never breaks the API call
    expect(calls).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('holds an approved email while the kill switch is on, and recovery sends it once the switch is off', async () => {
    const a = await newApproval();
    const p = process_();
    await p.gate.requested(a.id);
    await sql('update workspace_settings set kill_switch = 1');
    expect((await p.decide(a.id, true)).status).toBe(200);
    expect(sentFor(a.id)).toBe(0);
    expect(await statusOf(a.id)).toBe('approved'); // not lost

    await sql('update workspace_settings set kill_switch = 0');
    await process_().gate.recover();
    expect(sentFor(a.id)).toBe(1);
  });
});

/** A stand-in for Inngest's `step`, recording what the function asked for. */
function fakeStep(decision: { data: { approved: boolean } } | null) {
  const calls: { kind: 'wait' | 'run'; id: string; opts?: unknown }[] = [];
  const step: GateStep = {
    async waitForEvent(id, opts) {
      calls.push({ kind: 'wait', id, opts });
      return decision;
    },
    async run(id, fn) {
      calls.push({ kind: 'run', id });
      return fn();
    },
  };
  return { step, calls };
}
const opsLog = () => {
  const log: string[] = [];
  const ops: GateOps = {
    execute: async (id) => void log.push(`execute:${id}`),
    expire: async (id) => void log.push(`expire:${id}`),
  };
  return { ops, log };
};

describe('the approval gate on Inngest (S1-3)', () => {
  const event = { data: { approvalId: 'appr-1' } };

  it('waits up to three days for approval/decided matching this approval, by field and not by string', async () => {
    const { ops } = opsLog();
    const { step, calls } = fakeStep({ data: { approved: false } });
    await approvalGateHandler(ops)({ event, step });
    expect(calls[0]).toMatchObject({ kind: 'wait', id: 'await-decision', opts: { event: 'approval/decided', timeout: '3d', match: 'data.approvalId' } });
    expect(JSON.stringify(calls[0]!.opts)).not.toContain('appr-1'); // the id is never spliced into an expression
  });

  it('approved: runs the executor once, in its own step', async () => {
    const { ops, log } = opsLog();
    const { step, calls } = fakeStep({ data: { approved: true } });
    expect(await approvalGateHandler(ops)({ event, step })).toEqual({ status: 'executed' });
    expect(log).toEqual(['execute:appr-1']);
    expect(calls.filter((c) => c.kind === 'run').map((c) => c.id)).toEqual(['execute']);
  });

  it('rejected: executes nothing', async () => {
    const { ops, log } = opsLog();
    expect(await approvalGateHandler(ops)({ event, step: fakeStep({ data: { approved: false } }).step })).toEqual({ status: 'rejected' });
    expect(log).toEqual([]);
  });

  it('no decision in time: expires it and executes nothing', async () => {
    const { ops, log } = opsLog();
    const { step, calls } = fakeStep(null);
    expect(await approvalGateHandler(ops)({ event, step })).toEqual({ status: 'expired' });
    expect(log).toEqual(['expire:appr-1']);
    expect(calls.filter((c) => c.kind === 'run').map((c) => c.id)).toEqual(['expire']);
  });

  it('is registered to start on approval/requested and never retries', () => {
    const wf = createWorkflows({ execute: async () => ({ status: 'no_task' }), tickAll: async () => [], approvals: opsLog().ops });
    const configs = wf.functions.flatMap((f) =>
      (f as unknown as { getConfig(c: { baseUrl: URL; appPrefix: string }): unknown[] }).getConfig({ baseUrl: new URL('http://127.0.0.1:3100/inngest'), appPrefix: 'conclave-os' }),
    ) as { id: string; triggers: unknown[]; steps: { step: { retries: { attempts: number } } } }[];
    const gate = configs.find((c) => c.id === 'conclave-os-approval-gate')!;
    expect(gate.triggers).toEqual([{ event: 'approval/requested' }]);
    expect(gate.steps.step.retries.attempts).toBe(0);
    expect(configs.map((c) => c.id).sort()).toEqual(['conclave-os-agent-run', 'conclave-os-approval-gate', 'conclave-os-ticker']);
  });

  it('is not registered when there is nothing to execute', () => {
    const wf = createWorkflows({ execute: async () => ({ status: 'no_task' }), tickAll: async () => [] });
    expect(wf.functions).toHaveLength(2);
  });

  it('asks for the wait with one event per approval, and passes decisions on as events', async () => {
    const a = await newApproval();
    const sent: { name: string; id?: string; data: unknown }[] = [];
    const gate = createInngestGate({
      send: async (e) => void sent.push(e),
      pool: sys.app,
      workspaceId: ws(),
      executors: { run: async () => ({ status: 'executed' }), recover: async () => ({ resumed: [], unknown: [] }) },
    });
    await gate.requested(a.id);
    await gate.decided({ workspaceId: ws(), approvalId: a.id, approved: true });
    expect(sent).toEqual([
      { name: 'approval/requested', id: `approval-requested:${a.id}`, data: { approvalId: a.id, workspaceId: ws() } },
      { name: 'approval/decided', data: { approvalId: a.id, workspaceId: ws(), approved: true } },
    ]);
  });

  it('on start, asks again for every pending approval, expires the old ones, and recovers approved emails', async () => {
    const fresh = await newApproval();
    const old = await newApproval({ ageMs: DECISION_TIMEOUT_MS + 1000 });
    const approved = await newApproval({ status: 'approved' });
    const sent: { name: string; data: { approvalId?: string } }[] = [];
    const recovered: string[] = [];
    const gate = createInngestGate({
      send: async (e) => void sent.push(e as never),
      pool: sys.app,
      workspaceId: ws(),
      executors: {
        run: async () => ({ status: 'executed' }),
        recover: async () => {
          recovered.push('recover');
          return { resumed: [approved.id], unknown: [] };
        },
      },
    });
    const report = await gate.recover();
    expect(sent.filter((e) => e.name === 'approval/requested').map((e) => e.data.approvalId)).toContain(fresh.id);
    expect(sent.filter((e) => e.name === 'approval/requested').map((e) => e.data.approvalId)).not.toContain(old.id);
    expect(report.expired).toContain(old.id);
    expect(await statusOf(old.id)).toBe('expired');
    expect(recovered).toEqual(['recover']);
    expect(report.resumed).toContain(approved.id);
  });
});
