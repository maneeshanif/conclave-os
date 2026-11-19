import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { mayDecide, mayRequest, type Role } from '../src/auth/roles';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** Roles in team mode (S9-3). */
let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const ROLES: Role[] = ['owner', 'admin', 'member', 'viewer'];
const as = (user: string, method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json', 'x-test-user': user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  ({ sys } = await testSystem());
  for (const r of ROLES) await sql('insert into members (workspace_id, user_id, role) values ($1, $2, $3) on conflict do nothing', [ws(), `u-${r}`, r]);
  // A stand-in for the sign-in: the header names the person. Everything after it is the real server.
  const auth = { config: { webOrigin: 'http://127.0.0.1:3000' }, handler: async () => new Response('ok'), session: async (h: Headers) => (h.get('x-test-user') ? { userId: h.get('x-test-user')!, sessionId: 'sess-1234567890' } : null) };
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), auth: auth as never });
}, 240_000);
afterAll(() => sys?.close());

describe('the rules (S9-3)', () => {
  it('give the owner everything, an admin the setup, a member content and outreach, and a viewer only reading', () => {
    expect(ROLES.map((r) => mayRequest(r, 'GET', '/api/tasks'))).toEqual([true, true, true, true]);
    expect(ROLES.map((r) => mayRequest(r, 'POST', '/api/tasks'))).toEqual([true, true, true, false]);
    expect(ROLES.map((r) => mayRequest(r, 'PATCH', '/api/settings'))).toEqual([true, true, false, false]);
    expect(ROLES.map((r) => mayRequest(r, 'PUT', '/api/talent/policy'))).toEqual([true, false, false, false]);
    expect(ROLES.map((r) => mayDecide(r, 'email.send'))).toEqual([true, true, true, false]);
    for (const kind of ['hire', 'pr.merge', 'deploy', 'repo.create', 'skill.patch', 'agent.create']) expect(ROLES.map((r) => mayDecide(r, kind)), kind).toEqual([true, false, false, false]);
  });
});

describe('roles on the server (S9-3)', () => {
  it('turns away a request with no sign-in, and treats a signed-in person with no role as a viewer', async () => {
    expect((await app.request('/api/tasks')).status).toBe(401);
    expect((await as('u-nobody', 'GET', '/api/tasks')).status).toBe(200);
    expect((await as('u-nobody', 'POST', '/api/tasks', { title: 'x' })).status).toBe(403);
  });

  it('lets a viewer read and nothing else', async () => {
    expect((await as('u-viewer', 'GET', '/api/approvals')).status).toBe(200);
    for (const [m, u] of [['POST', '/api/tasks'], ['POST', `/api/approvals/${randomUUID()}/decide`], ['PATCH', '/api/settings']] as const) expect((await as('u-viewer', m, u, { approved: true })).status, `${m} ${u}`).toBe(403);
  });

  it('lets a member decide content, and refuses a hire, a deploy or a merge, in the approval route itself', async () => {
    const mk = async (kind: string) => (await sql("insert into approvals (workspace_id, kind, dedupe_key, payload) values ($1, $2, $3, '{}') returning id", [ws(), kind, `r:${randomUUID()}`])).rows[0].id as string;
    const post = await mk('post.publish');
    const hire = await mk('hire');
    expect((await as('u-member', 'POST', `/api/approvals/${hire}/decide`, { approved: true })).status).toBe(403);
    expect((await as('u-admin', 'POST', `/api/approvals/${hire}/decide`, { approved: true })).status).toBe(403);
    expect((await sql('select status from approvals where id = $1', [hire])).rows[0].status).toBe('pending');
    expect((await as('u-member', 'POST', `/api/approvals/${post}/decide`, { approved: true })).status).toBe(200);
    expect((await as('u-owner', 'POST', `/api/approvals/${hire}/decide`, { approved: true })).status).toBe(200);
  });

  it('keeps setup to admins and the hiring policy to the owner', async () => {
    expect((await as('u-member', 'PUT', '/api/talent/policy', { level: 'H1' })).status).toBe(403);
    expect((await as('u-admin', 'PUT', '/api/talent/policy', { level: 'H1' })).status).toBe(403);
    expect((await as('u-owner', 'PUT', '/api/talent/policy', { level: 'H1' })).status).toBe(200);
    await as('u-owner', 'PUT', '/api/talent/policy', { level: 'H0' });
  });
});
