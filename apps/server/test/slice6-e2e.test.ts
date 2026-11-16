import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/**
 * Slice 6, the server half of the end-to-end check (S6-11, SPEC 18 row 6). From the office: an agent is proposed for the Outreach
 * department, nothing exists until you approve, the approval runs the executor once and the agent is in the office (a role file, a
 * row, a desk, a place on the map, a team card, a drawer); you open a discussion that it is for and it stands in the Boardroom; you
 * close it and it goes back; you record a decision. The world half (walking, zones, drawers, panels, chat) is
 * apps/web/test/slice6-world.test.ts, and the real canvas is the browser run.
 */
let sys: System;
let app: ReturnType<typeof createApp>;
let executors: Executors;
let root = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const call = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
const json = async <T>(r: Response) => (await r.json()) as T;
const placeOf = async (key: string) => (await json<{ places: { key: string; place: string }[] }>(await call('GET', '/api/office/state'))).places.find((p) => p.key === key)?.place;

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-s6e2e-'));
  await cp(sys.companyRoot, root, { recursive: true });
  await rm(path.join(root, 'departments'), { recursive: true, force: true });
  const bus = new Bus();
  app = createApp({
    pool: sys.app,
    workspaceId: ws(),
    tokens: new RunTokens(),
    store: new MemoryOsStore(),
    bus,
    dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })),
    companyRoot: root,
    templatesRoot: sys.templatesRoot,
  });
  executors = createExecutors({
    pool: sys.app,
    workspaceId: ws(),
    transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')),
    companyRoot: root,
    from: 'hello@example.test',
    bus,
    agentFactory: (o) => agentNew({ ...sys, companyRoot: root }, o),
  });
  await agentNew({ ...sys, companyRoot: root }, { template: 'researcher', department: 'research', id: 'existing-one' }); // the company already has someone
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('slice 6 end to end (S6-11)', () => {
  let approvalId = '';
  let agentId = '';

  it('proposes an agent for Outreach from the office, and nothing exists until you approve', async () => {
    const r = await call('POST', '/api/office/agent-proposals', { department: 'outreach', template: 'researcher', name: 'Scout' });
    expect(r.status).toBe(201);
    approvalId = (await json<{ approvalId: string }>(r)).approvalId;
    expect((await sql('select status from approvals where id = $1', [approvalId])).rows[0].status).toBe('pending');
    expect(existsSync(path.join(root, 'departments', 'outreach', 'agents', 'outreach-researcher', 'AGENT.md'))).toBe(false);
    expect((await sql("select 1 from agents where key = 'outreach-researcher'")).rowCount).toBe(0);
  });

  it('adds the agent once the proposal is approved, and runs the executor only once', async () => {
    await sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [approvalId]);
    expect(await executors.run(approvalId)).toMatchObject({ status: 'executed' });
    expect(await executors.run(approvalId)).toEqual({ status: 'already_claimed' });
    expect(existsSync(path.join(root, 'departments', 'outreach', 'agents', 'outreach-researcher', 'AGENT.md'))).toBe(true);
    const rows = (await sql("select id, name from agents where key = 'outreach-researcher'")).rows;
    expect(rows).toHaveLength(1);
    agentId = rows[0].id;
  });

  it('shows the new agent in the office: a place on the map, a team card, and a drawer', async () => {
    expect(await placeOf('outreach-researcher')).toBeTruthy();
    const team = await json<{ team: { id: string; name: string }[] }>(await call('GET', '/api/office/team'));
    expect(team.team.some((t) => t.id === agentId)).toBe(true);
    const drawer = await call('GET', `/api/office/agents/${agentId}`);
    expect(drawer.status).toBe(200);
    expect((await json<{ agent: { key: string } }>(drawer)).agent.key).toBe('outreach-researcher');
  });

  it('puts the agent in the Boardroom for a discussion it is for, and back when you close it', async () => {
    const open = await call('POST', '/api/discussions', { kind: 'adhoc', question: 'Should we pause cold email?', participants: ['outreach-researcher'] });
    expect(open.status).toBe(201);
    const { id } = await json<{ id: string }>(open);
    expect(await placeOf('outreach-researcher')).toBe('boardroom');
    expect((await call('POST', `/api/discussions/${id}/close`, {})).status).toBe(200);
    expect(await placeOf('outreach-researcher')).not.toBe('boardroom');
  });

  it('records a decision, which only you can do', async () => {
    const r = await call('POST', '/api/decisions', { title: 'No weekend sends', decision: 'Nothing goes out on Saturday or Sunday.', owner: 'Outreach' });
    expect(r.status).toBe(201);
    const log = await json<{ decisions: { title: string; decided_by: string }[] }>(await call('GET', '/api/decisions'));
    expect(log.decisions[0]).toMatchObject({ title: 'No weekend sends', decided_by: 'founder' });
  });
});
