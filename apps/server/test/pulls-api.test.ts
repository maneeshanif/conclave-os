import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** The pull requests list (jsm-hq's PR drawer): exactly what the tables hold. */
let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 240_000);
afterAll(() => sys?.close());

describe('GET /api/pull-requests', () => {
  it('is empty at first, then lists each pull request with its tests, its approver and where a merge stands, newest first', async () => {
    expect(await (await app.request('/api/pull-requests')).json()).toEqual({ pulls: [] });
    const ap = async (key: string, ok: boolean) => (await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status) values ($1, 'pr.open', $2, $3, 'executed') returning id", [ws(), key, JSON.stringify({ tests: { ok } })])).rows[0].id as string;
    const a1 = await ap('o1', true);
    const a2 = await ap('o2', false);
    await sql("insert into code_pull_requests (workspace_id, approval_id, project_key, number, branch, base, head, title, summary, connector, approved_by, created_at) values ($1, $2, 'acme-site', 1, 'task/1', 'main', $3, 'Add the page', 'A page.', 'local', 'founder', now() - interval '1 hour')", [ws(), a1, 'a'.repeat(40)]);
    await sql("insert into code_pull_requests (workspace_id, approval_id, project_key, number, branch, base, head, title, summary, connector, approved_by) values ($1, $2, 'acme-site', 2, 'task/2', 'main', $3, 'Fix it', 'A fix.', 'local', 'founder')", [ws(), a2, 'b'.repeat(40)]);
    await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status) values ($1, 'pr.merge', 'merge:acme-site:1', '{}', 'pending')", [ws()]);
    const list = ((await (await app.request('/api/pull-requests')).json()) as { pulls: { number: number; title: string; head: string; testsPassed: boolean; mergeRequest: string | null; approvedBy: string; status: string }[] }).pulls;
    expect(list.map((p) => p.number)).toEqual([2, 1]);
    expect(list[0]).toMatchObject({ title: 'Fix it', testsPassed: false, mergeRequest: null, status: 'open', approvedBy: 'founder' });
    expect(list[1]).toMatchObject({ title: 'Add the page', testsPassed: true, mergeRequest: 'pending' });
    expect(list[1]!.head).toBe('a'.repeat(12));
    expect(list).toHaveLength(Number((await sql('select count(*)::int as n from code_pull_requests')).rows[0].n));
  });
});
