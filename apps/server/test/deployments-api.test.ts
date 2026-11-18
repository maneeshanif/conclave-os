import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** The deployments list (S7-9): exactly what the table holds, newest first, with why a failed one failed. */
let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot, templatesRoot: sys.templatesRoot });
}, 240_000);
afterAll(() => sys?.close());

describe('GET /api/deployments (S7-9)', () => {
  it('is empty at first, then matches the table: newest first, a failed one saying why, a live one with its link', async () => {
    expect(await (await app.request('/api/deployments')).json()).toEqual({ deployments: [] });
    const ap = async (n: number) => (await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status) values ($1, 'deploy', $2, '{}', 'executed') returning id", [ws(), `d${n}`])).rows[0].id as string;
    const a1 = await ap(1);
    const a2 = await ap(2);
    await sql("insert into deployments (workspace_id, approval_id, project_key, client, ref, status, url, approved_by, created_at, finished_at) values ($1, $2, 'acme-site', 'Acme', 'abc123', 'live', 'http://127.0.0.1:5001/', 'founder', now() - interval '1 hour', now())", [ws(), a1]);
    await sql("insert into deployments (workspace_id, approval_id, project_key, status, error, approved_by) values ($1, $2, 'beta-site', 'failed', 'The build failed: boom', 'founder')", [ws(), a2]);
    const list = ((await (await app.request('/api/deployments')).json()) as { deployments: Record<string, unknown>[] }).deployments;
    expect(list.map((d) => d.projectKey)).toEqual(['beta-site', 'acme-site']);
    expect(list[0]).toMatchObject({ status: 'failed', error: 'The build failed: boom', url: null, approvedBy: 'founder' });
    expect(list[1]).toMatchObject({ status: 'live', client: 'Acme', url: 'http://127.0.0.1:5001/', ref: 'abc123' });
    expect(list).toHaveLength(Number((await sql('select count(*)::int as n from deployments')).rows[0].n));
  });
});
