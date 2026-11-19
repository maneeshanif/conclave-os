import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { clearWithDelegate, createDelegate, HAND_DECISIONS_NEEDED, setDelegateActive, setMandateRule } from '../src/approvals/delegate';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { memoryBlock } from '../src/memory/memory';
import { runBakeOff, type Trial } from '../src/talent/bakeoff';
import { importCatalog } from '../src/talent/catalog';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/**
 * Slice 8, end to end (S8-12, SPEC 18 row 8): an edit you make changes the next draft; the Talent room runs a bake-off between three
 * catalog candidates and proposes the winner; the delegate clears one routine approval and refuses one outside its limit; and Research
 * proposes a change that passes its eval. Nothing outside the machine is touched, and every change waits for an approval.
 */
let sys: System;
let app: ReturnType<typeof createApp>;
let executors: Executors;
let store: DbOsStore;
let root = '';
let keyDir = '';
let repAgent = '';
let rAgent = '';
let rRun = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const decide = (id: string, body: unknown) => app.request(`/api/approvals/${id}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const raise = (id: string) => sql('update agents set autonomy = 2 where id = $1', [id]);

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-s8-'));
  keyDir = path.join(root, 'keys');
  await cp(sys.companyRoot, path.join(root, 'company'), { recursive: true });
  await rm(path.join(root, 'company', 'departments'), { recursive: true, force: true });
  await cp(sys.templatesRoot, path.join(root, 'templates'), { recursive: true });
  await cp(path.join(sys.templatesRoot, '..', 'plugins'), path.join(root, 'plugins'), { recursive: true });
  const companyRoot = path.join(root, 'company');
  const bus = new Bus();
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot, templatesRoot: sys.templatesRoot });
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot, from: 'hello@example.test', bus, templatesRoot: path.join(root, 'templates'), agentFactory: (o) => agentNew({ ...sys, companyRoot }, o) });
  await agentNew({ ...sys, companyRoot }, { template: 'outreach-rep', department: 'outreach', id: 's8-rep', name: 'Rep' });
  await agentNew({ ...sys, companyRoot }, { template: 'researcher', department: 'research', id: 's8-res', name: 'Rhea' });
  repAgent = (await sql("select id from agents where key = 's8-rep'")).rows[0].id;
  rAgent = (await sql("select id from agents where key = 's8-res'")).rows[0].id;
  await raise(rAgent);
  rRun = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), rAgent])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, companyRoot, () => undefined, () => undefined, path.join(root, 'templates'));
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('slice 8: the company learns, hires and delegates (S8-12)', () => {
  it('an edit you make changes what the next draft is told', async () => {
    const email = `e2e-${randomUUID().slice(0, 6)}@clinic.test`;
    const lead = (await sql("insert into leads (workspace_id, business_name, email) values ($1, 'Glow Clinic', $2) returning id", [ws(), email])).rows[0].id as string;
    const id = (await sql("insert into approvals (workspace_id, kind, dedupe_key, agent_id, payload) values ($1, 'email.send', $2, $3, $4) returning id", [ws(), `e2e:${randomUUID()}`, repAgent, JSON.stringify({ leadId: lead, to: email, subject: 'Booking page', body: 'Dear Sir, we are a leading agency.', step: 1 })])).rows[0].id as string;
    await sql("insert into outreach_messages (workspace_id, lead_id, approval_id, to_address, subject, body, status) values ($1, $2, $3, $4, 's', 'b', 'queued')", [ws(), lead, id, email]);
    expect(await memoryBlock(sys.app, ws(), repAgent, 'Write a booking page email for a clinic')).toBe('');
    expect((await decide(id, { approved: true, editedPayload: { subject: 'Booking page', body: 'Hi, your booking page asks for a call first. Want a faster one?' } })).status).toBe(200);
    expect(await memoryBlock(sys.app, ws(), repAgent, 'Write a booking page email for a clinic')).toMatch(/faster one/);
  });

  it('the Talent room runs a bake-off between three catalog candidates and proposes the winner, which is hired only on approval', async () => {
    const src = path.join(root, 'catalog');
    await mkdir(path.join(src, 'marketing'), { recursive: true });
    await writeFile(path.join(src, 'LICENSE'), 'MIT License');
    for (const [k, t] of [['steady', 'calm'], ['flashy', 'bold'], ['thin', 'plain']] as const) await writeFile(path.join(src, 'marketing', `${k}-writer.md`), `# ${k} Writer\n\nYou write ${t} clinic landing copy.\n`);
    await importCatalog(sys.app, ws(), src, { source: 'agency', pinnedId: 'abc' });
    const trial: Trial = async ({ role }) => (role.key === 'flashy-writer' ? { output: 'A bold page that also emails the whole list now.', boundaryAttempts: 1, costUsd: 0.2 } : role.key === 'steady-writer' ? { output: 'A calm page with one clear offer and a booked call.', boundaryAttempts: 0, costUsd: 0.2 } : { output: 'A page.', boundaryAttempts: 0, costUsd: 0.1 });
    const b = await runBakeOff(sys.app, ws(), { department: 'outreach', query: 'clinic landing copy', template: 'writer', trialTask: 'Write a landing page.', trial });
    expect(b.candidates).toHaveLength(3);
    expect(b.winner.key).toBe('steady-writer');
    await raise(rAgent);
    expect(await callOsTool(store, { workspaceId: ws(), agentId: rAgent, runId: rRun }, 'propose_hire', { bakeoff: b.id })).toMatch(/Nothing has been hired/);
    const talent = (await (await app.request('/api/talent')).json()) as { bakeoffs: unknown[]; hires: { status: string; name: string }[] };
    expect(talent.bakeoffs).toHaveLength(1);
    expect(talent.hires[0]).toMatchObject({ status: 'pending', name: 'steady Writer' });
    const hire = (await sql("select id from approvals where kind = 'hire'")).rows[0].id as string;
    expect((await sql("select count(*)::int as n from agents where key = 'outreach-steady-writer'")).rows[0].n).toBe(0);
    await sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [hire]);
    expect((await executors.run(hire)).status).toBe('executed');
    expect((await sql("select autonomy from agents where key = 'outreach-steady-writer'")).rows[0].autonomy).toBe(0);
  });

  it('the delegate clears one routine approval and refuses one outside its limit', async () => {
    await createDelegate(sys.app, ws(), keyDir);
    for (let i = 0; i < HAND_DECISIONS_NEEDED; i++) await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status, decided_by) values ($1, 'email.send', $2, '{}', 'executed', 'founder')", [ws(), `hand8:${i}`]);
    await setMandateRule(sys.app, ws(), { kind: 'email.send', minStep: 2, maxStep: 3 });
    await setDelegateActive(sys.app, ws(), true);
    const mk = async (step: number) => (await sql("insert into approvals (workspace_id, kind, dedupe_key, payload) values ($1, 'email.send', $2, $3) returning id", [ws(), `d8:${randomUUID()}`, JSON.stringify({ step, campaignId: randomUUID() })])).rows[0].id as string;
    const routine = await mk(2);
    const outside = await mk(1);
    expect(await clearWithDelegate(sys.app, ws(), keyDir, routine, 'A follow-up inside an approved sequence.')).toEqual({ outcome: 'cleared' });
    expect(await clearWithDelegate(sys.app, ws(), keyDir, outside, 'A first message.')).toEqual({ outcome: 'refused', reason: 'outside the mandate' });
    expect((await sql('select status from approvals where id = $1', [outside])).rows[0].status).toBe('pending');
    expect((await sql('select outcome from delegate_ledger where approval_id = any($1::uuid[]) order by outcome', [[routine, outside]])).rows.map((r) => r.outcome)).toEqual(['cleared', 'refused']);
  });

  it('Research proposes a change whose eval passes, and one whose eval fails never becomes a card', async () => {
    await raise(rAgent);
    const scope = { workspaceId: ws(), agentId: rAgent, runId: rRun };
    const text = `---\nname: cite-sources\ndescription: "Use when reporting any fact: attach the exact source to every claim, and say when none exists."\n---\n\n# Cite sources\n\n1. Every claim gets a source link.\n2. If there is none, say so.\n`;
    const base = { template: 'researcher', skill: 'cite-sources', text, why: 'Fewer unsourced claims.', evidence: [{ source: 'https://example.test/a', note: 'It worked for another team.' }], expectedGain: 'Fewer claims without a source.' };
    expect(await callOsTool(store, scope, 'propose_improvement', { ...base, evalCases: [{ mustContain: ['source link'] }] })).toMatch(/Nothing has changed/);
    const before = await readFile(path.join(root, 'templates', 'agents', 'researcher', 'skills', 'cite-sources', 'SKILL.md'), 'utf8');
    await expect(callOsTool(store, scope, 'propose_improvement', { ...base, why: 'Another.', evalCases: [{ mustContain: ['a phrase that is missing'] }] })).rejects.toThrow(/eval failed/);
    expect((await sql("select count(*)::int as n from improvements where status = 'proposed'")).rows[0].n).toBe(1);
    expect((await sql("select count(*)::int as n from improvements where status = 'eval_failed'")).rows[0].n).toBe(1);
    expect(before).not.toMatch(/source link/); // nothing changed without an approval
  });
});
