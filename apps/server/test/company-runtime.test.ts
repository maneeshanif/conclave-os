import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { agentNew } from '../src/commands/agent-new';
import { Bus } from '../src/bus';
import { Companies, type Company } from '../src/companies';
import { CompanyRuntimes, runCompanyMinute } from '../src/company-runtime';
import { withWorkspace } from '../src/db/tenant';
import type { System } from '../src/system';
import type { Dispatcher, RunRequestEvent } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let companies: Companies;
let runtimes: CompanyRuntimes;
let beta: Company;
const asked: RunRequestEvent[] = [];
const dispatcher: Dispatcher = { name: 'local', request: async (e) => void asked.push(e) };
const A = () => sys.workspace.id;
const sql = (ws: string, q: string, p: unknown[] = []) => withWorkspace(sys.app, ws, ({ client }) => client.query(q, p));
const proposal = async (ws: string, id: string, department = 'outreach') =>
  (await sql(ws, "insert into approvals (workspace_id, kind, dedupe_key, payload, status, decided_by, decided_at) values ($1, 'agent.create', $2, $3, 'approved', 'founder', now()) returning id", [ws, `agent:${id}`, JSON.stringify({ department, template: 'researcher', name: 'Bee', id })])).rows[0].id as string;
const agentKeys = async (ws: string) => (await sql(ws, 'select key from agents order by key')).rows.map((r) => r.key as string);

beforeAll(async () => {
  ({ sys } = await testSystem());
  companies = new Companies({ dataDir: sys.dataDir, templatesRoot: sys.templatesRoot, pool: sys.app, defaultCompany: { id: A(), slug: sys.workspace.slug, root: sys.companyRoot } });
  beta = await companies.create({ name: 'Beta Works', template: 'starter' });
  runtimes = new CompanyRuntimes({ sys, companies, bus: new Bus(), env: {} });
}, 240_000);
afterAll(async () => {
  runtimes?.stop();
  await sys?.close();
});

describe('every company has its own working parts (S6-13e)', () => {
  it('makes one for the default company and one for each other, for the right workspace and folder', async () => {
    const all = await runtimes.all();
    expect(all.map((r) => r.company.slug)).toEqual([sys.workspace.slug, 'beta-works']);
    expect(await runtimes.runtime(beta.id)).toBe(all[1]);
    expect(await runtimes.runtime('11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(await runtimes.runtime('not-an-id')).toBeNull();
    expect(runtimes.rootFor(beta.id)).toBe(beta.root);
    expect(runtimes.rootFor(A())).toBe(sys.companyRoot);
    expect(runtimes.rootFor('11111111-1111-4111-8111-111111111111')).toBeUndefined();
    expect(runtimes.sysFor(beta)).toMatchObject({ companyRoot: beta.root, workspace: { id: beta.id, slug: 'beta-works' } });
  });

  it('starts one: its folder is copied into its database rows and every agent\'s working folder is made from its role file', async () => {
    const rt = (await runtimes.runtime(beta.id))!;
    await agentNew(runtimes.sysFor(beta), { template: 'researcher', department: 'research', id: 'beta-first' });
    const r = await runtimes.start(rt);
    expect(r.agents).toBeGreaterThanOrEqual(1);
    expect(existsSync(path.join(sys.dataDir, 'workspaces', 'beta-works', 'agents', 'beta-first'))).toBe(true);
  });
});

describe('an approval is carried out in its own company (S6-13e)', () => {
  it('adds the agent in the second company, in its folder and its database, and nowhere else', async () => {
    const rt = (await runtimes.runtime(beta.id))!;
    const id = await proposal(beta.id, 'beta-added');
    await rt.gate.decided({ workspaceId: beta.id, approvalId: id, approved: true });
    expect(await agentKeys(beta.id)).toContain('beta-added');
    expect(existsSync(path.join(beta.root, 'departments', 'outreach', 'agents', 'beta-added', 'AGENT.md'))).toBe(true);
    expect(await agentKeys(A())).not.toContain('beta-added');
    expect(existsSync(path.join(sys.companyRoot, 'departments', 'outreach', 'agents', 'beta-added'))).toBe(false);
    expect((await sql(beta.id, 'select status from approvals where id = $1', [id])).rows[0].status).toBe('executed');
  });

  it('claims it once: deciding again changes nothing, and the other company\'s parts cannot reach it', async () => {
    const rtA = (await runtimes.runtime(A()))!;
    const rtB = (await runtimes.runtime(beta.id))!;
    const id = await proposal(beta.id, 'beta-once');
    await rtA.gate.decided({ workspaceId: beta.id, approvalId: id, approved: true }); // the wrong company's gate: it cannot see this approval
    expect(await agentKeys(beta.id)).not.toContain('beta-once');
    expect((await sql(beta.id, 'select status from approvals where id = $1', [id])).rows[0].status).toBe('approved');
    await rtB.gate.decided({ workspaceId: beta.id, approvalId: id, approved: true });
    await rtB.gate.decided({ workspaceId: beta.id, approvalId: id, approved: true });
    expect((await agentKeys(beta.id)).filter((k) => k === 'beta-once')).toHaveLength(1);
  });
});

describe('the run loop and the scheduler act for each company (S6-13e)', () => {
  it('gives the run loop the company\'s own slug and renders an agent from the company\'s own folder', async () => {
    const base = { pool: sys.app } as never;
    const loopB = await runtimes.loop(base, beta.id);
    expect(loopB.workspaceSlug).toBe('beta-works');
    await loopB.prepare!('beta-added', undefined);
    expect(existsSync(path.join(sys.dataDir, 'workspaces', 'beta-works', 'agents', 'beta-added'))).toBe(true);
    const loopA = await runtimes.loop(base, A());
    expect(loopA.workspaceSlug).toBe(sys.workspace.slug);
    await expect(runtimes.loop(base, '11111111-1111-4111-8111-111111111111')).rejects.toThrow(/unknown company/i);
  });

  it('wakes an agent in the second company, for that company', async () => {
    await sql(beta.id, "update agents set heartbeat_cron = '* * * * *' where key = 'beta-first'");
    asked.length = 0;
    const rt = (await runtimes.runtime(beta.id))!;
    await runCompanyMinute(rt, { dispatcher, asked: new Map(), bus: new Bus(), isRunActive: () => false });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((e) => e.workspaceId === beta.id)).toBe(true);
  });

  it('fails a silent run in each company, and never touches the other company\'s', async () => {
    const stale = (ws: string, agent: string) =>
      sql(ws, "insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at, heartbeat_at) values ($1, (select id from agents where key = $2), 'manual', 'claude-cli', 'running', now() - interval '2 hours', now() - interval '2 hours') returning id", [ws, agent]);
    await agentNew(sys, { template: 'researcher', department: 'research', id: 'alpha-first' });
    const a = (await stale(A(), 'alpha-first')).rows[0].id;
    const b = (await stale(beta.id, 'beta-first')).rows[0].id;
    const rtB = (await runtimes.runtime(beta.id))!;
    await runCompanyMinute(rtB, { dispatcher, asked: new Map(), bus: new Bus(), isRunActive: () => false });
    expect((await sql(beta.id, 'select status from runs where id = $1', [b])).rows[0].status).toBe('failed');
    expect((await sql(A(), 'select status from runs where id = $1', [a])).rows[0].status).toBe('running'); // not this company's turn yet
    const rtA = (await runtimes.runtime(A()))!;
    await runCompanyMinute(rtA, { dispatcher, asked: new Map(), bus: new Bus(), isRunActive: () => false });
    expect((await sql(A(), 'select status from runs where id = $1', [a])).rows[0].status).toBe('failed');
  });

  it('keeps one company\'s approvals, runs and tasks out of the other\'s', async () => {
    expect((await sql(A(), "select 1 from approvals where kind = 'agent.create'")).rows).toHaveLength(0);
    expect((await sql(beta.id, "select 1 from approvals where kind = 'agent.create'")).rows.length).toBeGreaterThan(0);
  });
});
