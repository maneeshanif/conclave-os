import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import { runBakeOff, type Trial } from '../src/talent/bakeoff';
import { importCatalog } from '../src/talent/catalog';
import { readHiring, rosterRoom, setHiring, tryAutoTrial } from '../src/talent/hiring';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** Hiring levels and the roster cap (S8-6). */
let sys: System;
let root = '';
let executors: Executors;
let store: DbOsStore;
let agentId = '';
let runId = '';
let n = 0;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const trial: Trial = async () => ({ output: 'A clear page with one offer.', boundaryAttempts: 0, costUsd: 0.1 });
const scope = () => ({ workspaceId: ws(), agentId, runId });
// Making an agent re-reads the company folder and sets every agent's level from its role file, so the proposer is raised again before each call.
const raise = () => sql('update agents set autonomy = 2 where id = $1', [agentId]);

/** A fresh bake-off with its own catalog role, so each test hires someone different. */
async function bakeoff(department = 'outreach', template = 'writer') {
  n++;
  const dir = path.join(root, `src${n}`);
  await mkdir(path.join(dir, 'marketing'), { recursive: true });
  await writeFile(path.join(dir, 'LICENSE'), 'MIT License');
  await writeFile(path.join(dir, 'marketing', `writer-${n}.md`), `# Writer ${n}\n\nYou write distinctive${n}word copy for clinics.\n`);
  await importCatalog(sys.app, ws(), dir, { source: `src${n}`, pinnedId: 'p' });
  return runBakeOff(sys.app, ws(), { department, query: `distinctive${n}word`, template, trialTask: 'Write.', trial });
}
const pendingHire = async (id: string) => (await sql("select id, status, decided_by from approvals where kind = 'hire' and payload->>'bakeoffId' = $1", [id])).rows[0];

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-lvl-'));
  await cp(sys.companyRoot, root, { recursive: true });
  await rm(path.join(root, 'departments'), { recursive: true, force: true });
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot: root, from: 'hello@example.test', agentFactory: (o) => agentNew({ ...sys, companyRoot: root }, o) });
  await agentNew({ ...sys, companyRoot: root }, { template: 'writer', department: 'outreach', id: 'lvl-boss', name: 'Boss' });
  agentId = (await sql("select id from agents where key = 'lvl-boss'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, root, () => undefined, () => undefined, sys.templatesRoot);
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('hiring levels (S8-6)', () => {
  it('start at H0 with a roster cap of 20, and H0 does nothing alone', async () => {
    expect(await readHiring(sys.app, ws())).toMatchObject({ level: 'H0', rosterCap: 20 });
    const b = await bakeoff();
    await raise();
    await callOsTool(store, scope(), 'propose_hire', { bakeoff: b.id });
    const a = await pendingHire(b.id);
    expect(a.status).toBe('pending');
    expect((await tryAutoTrial(sys.app, ws(), a.id, sys.templatesRoot)).auto).toBe(false);
    expect((await pendingHire(b.id)).status).toBe('pending');
  });

  it('at H1 puts a hire inside the mandate on trial by itself, as the mandate, and the new agent is at autonomy 0', async () => {
    await setHiring(sys.app, ws(), { level: 'H1' });
    const b = await bakeoff();
    await raise();
    expect(await callOsTool(store, scope(), 'propose_hire', { bakeoff: b.id })).toMatch(/inside the hiring mandate/i);
    const a = await pendingHire(b.id);
    expect(a).toMatchObject({ status: 'approved', decided_by: 'mandate:H1' });
    expect((await sql("select count(*)::int as n from audit_log where action = 'hire.auto_trial' and subject = $1", [a.id])).rows[0].n).toBe(1);
    expect((await executors.run(a.id)).status).toBe('executed');
    expect((await sql(`select autonomy from agents where key = $1`, [`outreach-writer-${n}`])).rows[0].autonomy).toBe(0);
  });

  it('at H1 leaves a hire outside the mandate for a person: a department that is off, a budget over the cap', async () => {
    const off = await bakeoff('marketing');
    await raise();
    await callOsTool(store, scope(), 'propose_hire', { bakeoff: off.id });
    const a = await pendingHire(off.id);
    expect(a.status).toBe('pending');
    expect(await tryAutoTrial(sys.app, ws(), a.id, sys.templatesRoot)).toMatchObject({ auto: false, reason: expect.stringMatching(/not switched on/) });

    await setHiring(sys.app, ws(), { trialBudgetCapUsd: 1 });
    const dear = await bakeoff();
    await raise();
    await callOsTool(store, scope(), 'propose_hire', { bakeoff: dear.id });
    expect((await pendingHire(dear.id)).status).toBe('pending');
    await setHiring(sys.app, ws(), { trialBudgetCapUsd: 5 });
    await expect(setHiring(sys.app, ws(), { level: 'H2' as never })).rejects.toThrow(/H0 or H1/);
  });
});

describe('the roster cap (S8-6)', () => {
  it('refuses a proposal when the roster is full, and an approved hire that arrives after it filled', async () => {
    const b = await bakeoff();
    await raise();
    await callOsTool(store, scope(), 'propose_hire', { bakeoff: b.id });
    const queued = await pendingHire(b.id);
    await sql("update approvals set status = 'pending', decided_by = null where id = $1", [queued.id]);
    const room = await rosterRoom(sys.app, ws());
    await setHiring(sys.app, ws(), { rosterCap: Math.max(1, room.active) });
    expect((await rosterRoom(sys.app, ws())).ok).toBe(false);
    const c = await bakeoff();
    await expect(callOsTool(store, scope(), 'propose_hire', { bakeoff: c.id })).rejects.toThrow(/roster/i);
    await sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [queued.id]);
    expect((await executors.run(queued.id)).status).toBe('failed');
    expect((await sql("select count(*)::int as n from agents where key like $1", [`outreach-writer-${n - 1}`])).rows[0].n).toBe(0);
    await setHiring(sys.app, ws(), { rosterCap: 20 });
  });
});
