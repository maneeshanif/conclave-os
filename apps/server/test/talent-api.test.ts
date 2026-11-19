import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** The Talent room's data (S8-8): what the tables hold. */
let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 240_000);
afterAll(() => sys?.close());

describe('GET /api/talent (S8-8)', () => {
  it('starts with the default policy and nothing else', async () => {
    const t = (await (await app.request('/api/talent')).json()) as { policy: Record<string, unknown>; bakeoffs: unknown[]; catalog: unknown[]; hires: unknown[] };
    expect(t.policy).toMatchObject({ level: 'H0', rosterCap: 20, trialBudgetCapUsd: 5 });
    expect([t.bakeoffs, t.catalog, t.hires]).toEqual([[], [], []]);
  });

  it('matches the tables: bake-offs with their scores, the catalog by source with its flagged count, and the hires', async () => {
    await sql("insert into bakeoffs (workspace_id, department, query, template, trial_task, candidates) values ($1, 'outreach', 'copy', 'writer', 't', $2)", [ws(), JSON.stringify([{ key: 'a', name: 'A', boundaryAttempts: 0, rating: 50, costUsd: 0.1 }])]);
    await sql("insert into catalog_roles (workspace_id, source, key, division, name, text, hash, pinned_id, license, flagged) values ($1, 'agency', 'a', 'marketing', 'A', 't', 'h1', 'p', 'MIT', false), ($1, 'agency', 'b', 'marketing', 'B', 't', 'h2', 'p', 'MIT', true)", [ws()]);
    await sql("insert into approvals (workspace_id, kind, dedupe_key, payload) values ($1, 'hire', 'hire:x', $2)", [ws(), JSON.stringify({ department: 'outreach', winner: { name: 'A' } })]);
    const t = (await (await app.request('/api/talent')).json()) as { bakeoffs: { department: string; candidates: unknown[] }[]; catalog: { source: string; roles: number; flagged: number }[]; hires: { name: string; status: string }[] };
    expect(t.bakeoffs).toHaveLength(1);
    expect(t.bakeoffs[0]).toMatchObject({ department: 'outreach' });
    expect(t.catalog).toEqual([{ source: 'agency', roles: 2, flagged: 1 }]);
    expect(t.hires).toEqual([expect.objectContaining({ name: 'A', status: 'pending' })]);
  });

  it('changes the hiring policy, within limits, and refuses H2 and nonsense', async () => {
    const put = (body: unknown) => app.request('/api/talent/policy', { method: 'PUT', headers: json, body: JSON.stringify(body) });
    expect(((await (await put({ level: 'H1', rosterCap: 12 })).json()) as { policy: Record<string, unknown> }).policy).toMatchObject({ level: 'H1', rosterCap: 12 });
    expect((await put({ level: 'H2' })).status).toBe(400);
    expect((await put({ rosterCap: 0 })).status).toBe(400);
    expect((await put({ surprise: 1 })).status).toBe(400);
    await put({ level: 'H0', rosterCap: 20 });
  });
});
