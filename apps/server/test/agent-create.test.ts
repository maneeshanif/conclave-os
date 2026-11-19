import { existsSync } from 'node:fs';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let app: ReturnType<typeof createApp>;
let executors: Executors;
let root = '';
const seen: BusMessage[] = [];
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const call = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
const propose = (body: unknown) => call('POST', '/api/office/agent-proposals', body);
const agentsNow = async () => (await sql('select key from agents order by key')).rows.map((r) => r.key as string);
const approvalsOfKind = async () => (await sql("select id, status, payload, result from approvals where kind = 'agent.create' order by created_at")).rows;
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-agent-'));
  await cp(sys.companyRoot, root, { recursive: true });
  await rm(path.join(root, 'departments'), { recursive: true, force: true });
  const bus = new Bus();
  bus.subscribe((m) => seen.push(m));
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: root, templatesRoot: sys.templatesRoot });
  executors = createExecutors({
    pool: sys.app,
    workspaceId: ws(),
    transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')),
    companyRoot: root,
    from: 'hello@example.test',
    bus,
    agentFactory: (o) => agentNew({ ...sys, companyRoot: root }, o),
  });
  await agentNew({ ...sys, companyRoot: root }, { template: 'researcher', department: 'research', id: 'existing-one' });
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  seen.length = 0;
});

describe('proposing an agent from the world (S6-13c)', () => {
  it('lists the agent templates', async () => {
    const r = await call('GET', '/api/office/agent-templates');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { templates: string[] };
    expect(body.templates).toContain('researcher');
    expect(body.templates.every((t) => /^[a-z0-9-]+$/.test(t))).toBe(true);
  });

  it('makes a proposal that waits for a decision, and creates nothing', async () => {
    const before = await agentsNow();
    const r = await propose({ department: 'outreach', template: 'researcher', name: 'Scout' });
    expect(r.status).toBe(201);
    const { approvalId, id } = (await r.json()) as { approvalId: string; id: string };
    expect(id).toBe('outreach-researcher');
    const [a] = await approvalsOfKind();
    expect(a).toMatchObject({ id: approvalId, status: 'pending', payload: { department: 'outreach', template: 'researcher', name: 'Scout', id: 'outreach-researcher' } });
    expect(await agentsNow()).toEqual(before);
    expect(existsSync(path.join(root, 'departments', 'outreach', 'agents', 'outreach-researcher', 'AGENT.md'))).toBe(false);
    expect(seen.some((m) => m.kind === 'approval.changed' && (m as { status: string }).status === 'pending')).toBe(true);
  });

  it('gives a second proposal for the same department and template its own id', async () => {
    const r = await propose({ department: 'outreach', template: 'researcher' });
    expect(((await r.json()) as { id: string }).id).toBe('outreach-researcher-2');
  });

  it('refuses an unknown department or template, a path out of the templates folder, and a bad name, and makes no proposal', async () => {
    const n = (await approvalsOfKind()).length;
    for (const body of [
      { department: 'nowhere', template: 'researcher' },
      { department: 'outreach', template: 'no-such-template' },
      { department: 'outreach', template: '../company' },
      { department: 'outreach', template: '' },
      { department: 'outreach', template: 'researcher', name: 'x'.repeat(61) },
      { department: 'outreach', template: 'researcher', name: 5 },
      { department: 5, template: 'researcher' },
      {},
    ]) {
      expect((await propose(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await approvalsOfKind()).length).toBe(n);
  });
});

describe('the executor that adds the agent (S6-13c)', () => {
  it('does nothing for a proposal that is only pending, or was rejected', async () => {
    const [pending] = await approvalsOfKind();
    expect(await executors.run(pending.id)).toEqual({ status: 'already_claimed' });
    await sql("update approvals set status = 'rejected' where id = $1", [pending.id]);
    expect(await executors.run(pending.id)).toEqual({ status: 'already_claimed' });
    expect(await agentsNow()).not.toContain('outreach-researcher');
    await sql("update approvals set status = 'pending' where id = $1", [pending.id]);
  });

  it('adds exactly one agent when approved: a role file, a database row and a desk in its department\'s room', async () => {
    const [a] = await approvalsOfKind();
    await approve(a.id);
    const result = await executors.run(a.id);
    expect(result).toMatchObject({ status: 'executed' });
    expect(existsSync(path.join(root, 'departments', 'outreach', 'agents', 'outreach-researcher', 'AGENT.md'))).toBe(true);
    expect(await agentsNow()).toContain('outreach-researcher');
    expect((await sql('select status, result from approvals where id = $1', [a.id])).rows[0]).toMatchObject({ status: 'executed', result: { agentId: 'outreach-researcher' } });
    const office = (await (await call('GET', '/api/office')).json()) as { agents: { key: string; room: string | null; desk: number | null; name: string }[] };
    const mine = office.agents.find((x) => x.key === 'outreach-researcher')!;
    expect(mine).toMatchObject({ room: 'Outreach' });
    expect(mine.desk).toBeGreaterThanOrEqual(1);
    expect(seen.some((m) => m.kind === 'approval.changed' && (m as { status: string }).status === 'executed')).toBe(true);
  });

  it('claims the approval once: approving twice, even at the same moment, adds one agent', async () => {
    const r = await propose({ department: 'lead-gen', template: 'researcher', name: 'Hunter' });
    const { approvalId } = (await r.json()) as { approvalId: string };
    await approve(approvalId);
    const both = await Promise.all([executors.run(approvalId), executors.run(approvalId)]);
    expect(both.every((x) => x.status === 'executed')).toBe(true); // both callers are told the one result
    expect((await executors.run(approvalId)).status).toBe('already_claimed');
    expect((await agentsNow()).filter((k) => k === 'lead-gen-researcher')).toHaveLength(1);
  });

  it('does not act while the kill switch is on, and the proposal stays approved', async () => {
    const r = await propose({ department: 'research', template: 'researcher' });
    const { approvalId } = (await r.json()) as { approvalId: string };
    await approve(approvalId);
    await sql('update workspace_settings set kill_switch = 1');
    expect(await executors.run(approvalId)).toEqual({ status: 'kill_switch' });
    expect((await sql('select status from approvals where id = $1', [approvalId])).rows[0].status).toBe('approved');
    await sql('update workspace_settings set kill_switch = 0');
    expect((await executors.run(approvalId)).status).toBe('executed');
  });

  it('fails clearly, and tells the person, if the agent could not be made (the id was taken in the meantime)', async () => {
    const r = await propose({ department: 'research', template: 'researcher', name: 'Dup' });
    const { approvalId, id } = (await r.json()) as { approvalId: string; id: string };
    await agentNew({ ...sys, companyRoot: root }, { template: 'researcher', department: 'research', id });
    await approve(approvalId);
    const out = await executors.run(approvalId);
    expect(out.status).toBe('failed');
    expect((await sql('select status from approvals where id = $1', [approvalId])).rows[0].status).toBe('failed');
    expect((await sql("select title from action_items where approval_id = $1 and kind = 'executor_failed'", [approvalId])).rows).toHaveLength(1);
  });

  it('finishes a proposal that was approved when the server stopped, once', async () => {
    const r = await propose({ department: 'outreach', template: 'researcher', name: 'Late' });
    const { approvalId, id } = (await r.json()) as { approvalId: string; id: string };
    await approve(approvalId);
    const rec = await executors.recover();
    expect(rec.resumed).toContain(approvalId);
    expect(await agentsNow()).toContain(id);
    const again = await executors.recover();
    expect(again.resumed).not.toContain(approvalId);
  });

  it('leaves the other approval kinds alone', async () => {
    expect((await readdir(path.join(root, 'departments'))).sort()).toEqual(expect.arrayContaining(['lead-gen', 'outreach', 'research']));
  });
});
