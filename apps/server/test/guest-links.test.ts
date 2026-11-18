import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import { guestRoutes, openGuestLink, revokeGuestLink } from '../src/meetings/guest';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** Meetings and guest links (S10-1): a link opens only its own meeting, expires, can be revoked, and is never stored. */
let sys: System;
let executors: Executors;
let store: DbOsStore;
let outbox = '';
let agentId = '';
let runId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId });
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);
const meeting = async (title: string) => (await sql("insert into meetings (workspace_id, title, starts_at) values ($1, $2, now() + interval '1 day') returning id", [ws(), title])).rows[0].id as string;

/** Proposes, approves and runs an invite; returns the link from the outbox file, which is the only place the token is. */
async function invite(meetingId: string, to = 'client@example.test', ttlHours?: number) {
  await callOsTool(store, scope(), 'propose_meeting', { meetingId, to, ...(ttlHours ? { ttlHours } : {}) });
  const a = (await sql("select id from approvals where kind = 'meeting.invite' and payload->>'meetingId' = $1 order by created_at desc", [meetingId])).rows[0].id as string;
  await approve(a);
  expect((await executors.run(a)).status).toBe('executed');
  const file = (await readdir(path.join(outbox, 'invites'))).find((f) => f.startsWith(a))!;
  const { url } = JSON.parse(await readFile(path.join(outbox, 'invites', file), 'utf8')) as { url: string };
  return { approval: a, token: url.split('/meet/')[1]!, url };
}

beforeAll(async () => {
  ({ sys } = await testSystem());
  outbox = await mkdtemp(path.join(tmpdir(), 'conclave-meet-'));
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(outbox, 'mail')), companyRoot: sys.companyRoot, from: 'hello@example.test', dataDir: outbox });
  await agentNew(sys, { template: 'writer', department: 'outreach', id: 'meet-w', name: 'Mo' });
  agentId = (await sql("select id from agents where key = 'meet-w'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (outbox) await rm(outbox, { recursive: true, force: true });
});

describe('guest links (S10-1)', () => {
  it('are made only after an approval, and the link goes to the invite file, not into the tables', async () => {
    const m = await meeting('Kickoff with Glow Clinic');
    expect(await callOsTool(store, scope(), 'propose_meeting', { meetingId: m, to: 'dana@glow.test' })).toMatch(/Nothing has been sent/);
    const a = (await sql("select id, status, payload from approvals where kind = 'meeting.invite'")).rows[0];
    expect(a.status).toBe('pending');
    expect((await sql('select count(*)::int as n from guest_links')).rows[0].n).toBe(0);
    expect(existsSync(path.join(outbox, 'invites'))).toBe(false);
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    expect((await sql('select count(*)::int as n from guest_links')).rows[0].n).toBe(1);
    const file = (await readdir(path.join(outbox, 'invites')))[0]!;
    const sent = JSON.parse(await readFile(path.join(outbox, 'invites', file), 'utf8')) as { to: string; url: string };
    expect(sent.to).toBe('dana@glow.test');
    const token = sent.url.split('/meet/')[1]!;
    // Nothing in the database can be turned back into the token: only its hash is there, and not in the approval either.
    const dump = JSON.stringify([(await sql('select * from guest_links')).rows, (await sql('select payload, result from approvals where id = $1', [a.id])).rows]);
    expect(dump).not.toContain(token.split('.')[1]);
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    expect((await sql('select count(*)::int as n from guest_links')).rows[0].n).toBe(1);
  });

  it('open only their own meeting, count each opening, and refuse a wrong token', async () => {
    const m1 = await meeting('Review with Acme');
    const m2 = await meeting('Review with Beta');
    const a = await invite(m1);
    const b = await invite(m2);
    expect(await openGuestLink(sys.app, a.token)).toMatchObject({ meetingId: m1, title: 'Review with Acme' });
    expect(await openGuestLink(sys.app, b.token)).toMatchObject({ meetingId: m2 });
    expect((await sql('select used_count from guest_links where meeting_id = $1', [m1])).rows[0].used_count).toBe(1);
    const [w, secret] = a.token.split('.');
    expect(await openGuestLink(sys.app, `${w}.${secret!.slice(0, -2)}xx`)).toBeNull();
    expect(await openGuestLink(sys.app, `${randomUUID()}.${secret}`)).toBeNull();
    for (const bad of ['', 'nonsense', 'a.b.c', `${w}.`]) expect(await openGuestLink(sys.app, bad)).toBeNull();
  });

  it('expire, and can be revoked', async () => {
    const m = await meeting('Short link');
    const l = await invite(m, 'a@b.test', 1);
    expect(await openGuestLink(sys.app, l.token)).not.toBeNull();
    await sql("update guest_links set expires_at = now() - interval '1 minute' where meeting_id = $1", [m]);
    expect(await openGuestLink(sys.app, l.token)).toBeNull();
    const m2 = await meeting('Revoked link');
    const r = await invite(m2);
    const id = (await sql('select id from guest_links where meeting_id = $1', [m2])).rows[0].id as string;
    expect(await openGuestLink(sys.app, r.token)).not.toBeNull();
    await revokeGuestLink(sys.app, ws(), id);
    expect(await openGuestLink(sys.app, r.token)).toBeNull();
  });

  it('are refused for a meeting that is gone or cancelled, and for a bad address', async () => {
    await expect(callOsTool(store, scope(), 'propose_meeting', { meetingId: randomUUID(), to: 'a@b.test' })).rejects.toThrow(/No such meeting/);
    const m = await meeting('Cancelled one');
    await sql("update meetings set status = 'cancelled' where id = $1", [m]);
    await expect(callOsTool(store, scope(), 'propose_meeting', { meetingId: m, to: 'a@b.test' })).rejects.toThrow(/cancelled/);
    const ok = await meeting('Fine one');
    await expect(callOsTool(store, scope(), 'propose_meeting', { meetingId: ok, to: 'not-an-address' })).rejects.toThrow(/Bad input/);
  });

  it('are served by a small route that shows a guest the title and the time and nothing else', async () => {
    const m = await meeting('Planning call');
    const l = await invite(m);
    const app = guestRoutes({ pool: sys.app });
    const res = await app.request(`/${l.token}`);
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()) as object).sort()).toEqual(['startsAt', 'title']);
    expect((await app.request('/bad.token')).status).toBe(404);
    expect((await app.request(`/${l.token}`, { method: 'POST' })).status).toBe(404);
  });
});
