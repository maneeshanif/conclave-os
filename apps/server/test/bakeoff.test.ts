import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** Bake-off and propose_hire (S8-5): three candidates run the same trial, boundaries are scored first, and the winner is a card for a person. */
let sys: System;
let root = '';
let src = '';
let executors: Executors;
let store: DbOsStore;
let agentId = '';
let runId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);
const put = async (rel: string, text: string) => {
  await mkdir(path.dirname(path.join(src, rel)), { recursive: true });
  await writeFile(path.join(src, rel), text);
};

// The scripted trial: the same task for each; "Flashy" writes the best copy but tries something it must not.
const trial: Trial = async ({ role }) => {
  if (role.key === 'flashy-copywriter') return { output: 'A long, vivid page with a clear offer and a booked call. Send it to the whole list now.', boundaryAttempts: 2, costUsd: 0.4 };
  if (role.key === 'steady-copywriter') return { output: 'A clear page with a clear offer and a booked call.', boundaryAttempts: 0, costUsd: 0.3 };
  return { output: 'Page.', boundaryAttempts: 0, costUsd: 0.1 };
};

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-hire-'));
  await cp(sys.companyRoot, root, { recursive: true });
  await rm(path.join(root, 'departments'), { recursive: true, force: true });
  src = path.join(root, 'catalog-src');
  await put('LICENSE', 'MIT License');
  await put('marketing/flashy-copywriter.md', '# Flashy Copywriter\n\nYou write bold landing page copy with a clear offer.\n');
  await put('marketing/steady-copywriter.md', '# Steady Copywriter\n\nYou write calm landing page copy with a clear offer.\n');
  await put('marketing/thin-copywriter.md', '# Thin Copywriter\n\nYou write landing page copy.\n');
  await importCatalog(sys.app, ws(), src, { source: 'agency', pinnedId: 'c0ffee' });
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot: root, from: 'hello@example.test', agentFactory: (o) => agentNew({ ...sys, companyRoot: root }, o) });
  await agentNew({ ...sys, companyRoot: root }, { template: 'chief-of-staff', department: 'chief-of-staff', id: 'hire-cos', name: 'Maya' }).catch(() => undefined);
  agentId = (await sql("select id from agents where key = 'hire-cos'")).rows[0]?.id ?? (await sql('select id from agents limit 1')).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, root);
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('the bake-off (S8-5)', () => {
  let bakeoff = '';

  it('runs up to three candidates through the same trial and ranks them, boundaries first', async () => {
    const r = await runBakeOff(sys.app, ws(), { department: 'outreach', query: 'landing page copy', template: 'writer', trialTask: 'Write a landing page for a clinic.', trial, limit: 3 });
    bakeoff = r.id;
    expect(r.candidates).toHaveLength(3);
    expect(r.candidates.map((c) => c.key)).toEqual(['steady-copywriter', 'thin-copywriter', 'flashy-copywriter']);
    expect(r.candidates[2]).toMatchObject({ boundaryAttempts: 2 });
    expect(r.winner.key).toBe('steady-copywriter');
    expect((await sql('select status from bakeoffs where id = $1', [r.id])).rows[0].status).toBe('scored');
  });

  it('refuses a bake-off with no candidates, and never trials a flagged persona', async () => {
    await expect(runBakeOff(sys.app, ws(), { department: 'outreach', query: 'zebra', template: 'writer', trialTask: 't', trial })).rejects.toThrow(/no candidates/i);
  });

  it('becomes a hire card with every score, and nothing exists until it is approved', async () => {
    expect(await callOsTool(store, { workspaceId: ws(), agentId, runId }, 'propose_hire', { bakeoff: bakeoff })).toMatch(/Nothing has been hired/);
    const a = (await sql("select id, status, payload from approvals where kind = 'hire'")).rows[0];
    expect(a.status).toBe('pending');
    expect(a.payload).toMatchObject({ department: 'outreach', template: 'writer', winner: { source: 'agency', key: 'steady-copywriter' } });
    expect(a.payload.scores).toHaveLength(3);
    expect(a.payload.scores[2]).toMatchObject({ key: 'flashy-copywriter', boundaryAttempts: 2 });
    expect(existsSync(path.join(root, 'departments', 'outreach', 'agents', 'outreach-steady-copywriter'))).toBe(false);
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    expect(await callOsTool(store, { workspaceId: ws(), agentId, runId }, 'propose_hire', { bakeoff })).toMatch(/Already queued/);

    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    const file = path.join(root, 'departments', 'outreach', 'agents', 'outreach-steady-copywriter', 'AGENT.md');
    const text = await readFile(file, 'utf8');
    expect(text).toMatch(/autonomy: 0/);
    expect(text).toMatch(/Steady Copywriter/);
    expect(text).toMatch(/calm landing page copy/); // the persona, under a heading that says what it is
    expect(text).toMatch(/Company rules win/i);
    expect((await sql("select status, autonomy from agents where key = 'outreach-steady-copywriter'")).rows[0]).toMatchObject({ autonomy: 0 });
    expect((await executors.run(a.id)).status).toBe('already_claimed');
  });
});
