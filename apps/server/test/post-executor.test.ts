import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { browserPostTransport, outboxPostTransport, SessionExpiredError, type BrowserDriver, type PostTransport } from '../src/actions/post-transport';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalApprovalGate } from '../src/workflows/approval-gate';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let store: DbOsStore;
let agentId = '';
let runId = '';
let taskId = '';
let companyRoot = '';
let xAccount = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId, taskId });
const TEXT = 'We rebuilt a clinic booking page so patients can book in two taps.';
const COMPANY = '# Acme\nBuilds start at $1,500.\n\n## Approved link domains\n- acme.test\n';

let n = 0;
/** A proposed post, approved by a person the way the API does it (the row is what the gate and the executor read). */
async function approvedPost(text = `${TEXT} ${++n}`) {
  const r = await callOsTool(store, scope(), 'propose_post', { accountId: xAccount, text });
  const approvalId = /as ([0-9a-f-]{36})/.exec(r)![1]!;
  await sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [approvalId]);
  return approvalId;
}
const approval = async (id: string) => (await sql('select status, result from approvals where id = $1', [id])).rows[0];
const post = async (approvalId: string) => (await sql('select status, text, published_url, published_at, error from posts where approval_id = $1', [approvalId])).rows[0];
const items = async (kind: string) => (await sql('select title, body from action_items where kind = $1', [kind])).rows;
const outboxFiles = () => (existsSync(path.join(sys.dataDir, 'outbox', 'posts')) ? readdirSync(path.join(sys.dataDir, 'outbox', 'posts')) : []);

const executorsWith = (postTransport: PostTransport): Executors =>
  createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot, from: 'hello@acme.test', postTransport });

beforeAll(async () => {
  ({ sys } = await testSystem());
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-co-postx-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), COMPANY);
  store = new DbOsStore(sys.app, () => undefined, companyRoot);
  await agentNew(sys, { template: 'writer', department: 'marketing', id: 'post-writer-2' });
  agentId = (await sql("select id from agents where key = 'post-writer-2'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  taskId = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 'post', 'in_progress', $2, $2, 'founder') returning id", [ws(), agentId])).rows[0].id;
  runId = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId, taskId])).rows[0].id;
  xAccount = (await sql("insert into channel_accounts (workspace_id, channel, handle) values ($1, 'x', '@acme_test') returning id", [ws()])).rows[0].id;
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await rm(path.join(sys.dataDir, 'outbox', 'posts'), { recursive: true, force: true });
  await rm(path.join(sys.dataDir, 'screenshots'), { recursive: true, force: true });
  await rm(path.join(sys.dataDir, 'outbox', 'posts'), { recursive: true, force: true });
  await rm(path.join(sys.dataDir, 'screenshots'), { recursive: true, force: true });
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  await sql("update channel_accounts set health = 'ok'");
  await sql('delete from posts');
  await sql('delete from action_items where approval_id is not null');
  await sql("delete from action_items where kind in ('session_expired','executor_failed','send_unknown')");
  await sql("delete from approvals where kind = 'post.publish'");
});

describe('publishing through the outbox (S5-2)', () => {
  it('writes the approved post once, marks it published, and keeps the record on the approval', async () => {
    const id = await approvedPost();
    const ex = executorsWith(outboxPostTransport(sys.dataDir));
    expect(await ex.run(id)).toMatchObject({ status: 'executed' });
    expect(outboxFiles()).toHaveLength(1);
    const file = JSON.parse(readFileSync(path.join(sys.dataDir, 'outbox', 'posts', outboxFiles()[0]!), 'utf8'));
    expect(file).toMatchObject({ platform: 'x', handle: '@acme_test', text: expect.stringContaining('clinic booking page') });
    const a = await approval(id);
    expect(a.status).toBe('executed');
    expect(a.result).toMatchObject({ transport: 'outbox', url: expect.stringContaining(id) });
    const p = await post(id);
    expect(p).toMatchObject({ status: 'published', published_url: a.result.url });
    expect(p.published_at).toBeTruthy();
    expect((await sql("select actor, action from audit_log where subject = $1 and action = 'approval.executed'", [id])).rows[0]).toMatchObject({ actor: 'executor:post' });
  });

  it('publishes once however many times and however fast it is asked', async () => {
    const id = await approvedPost();
    const ex = executorsWith(outboxPostTransport(sys.dataDir));
    const results = await Promise.all([ex.run(id), ex.run(id), ex.run(id)]);
    expect(results.every((r) => (r as { status: string }).status === 'executed')).toBe(true); // asked together, answered by the one run
    expect(await ex.run(id)).toMatchObject({ status: 'already_claimed' });
    expect(outboxFiles()).toHaveLength(1);
  });

  it('never publishes what is pending, rejected or expired', async () => {
    const ex = executorsWith(outboxPostTransport(sys.dataDir));
    for (const status of ['pending', 'rejected', 'expired']) {
      const id = await approvedPost();
      await sql('update approvals set status = $2 where id = $1', [id, status]);
      expect(await ex.run(id)).toMatchObject({ status: 'already_claimed' });
    }
    expect(outboxFiles()).toHaveLength(0);
  });

  it('does nothing while the kill switch is on, and the post stays approved', async () => {
    const id = await approvedPost();
    await sql('update workspace_settings set kill_switch = 1 where workspace_id = $1', [ws()]);
    expect(await executorsWith(outboxPostTransport(sys.dataDir)).run(id)).toMatchObject({ status: 'kill_switch' });
    expect((await approval(id)).status).toBe('approved');
    expect(outboxFiles()).toHaveLength(0);
  });

  it('publishes the text a person edited, and checks it again; a blocked claim added in the edit is refused and raised', async () => {
    const ok = await approvedPost();
    await sql("update approvals set edited_payload = jsonb_set(payload, '{text}', to_jsonb($2::text)) where id = $1", [ok, 'A tighter version of the same post.']);
    expect(await executorsWith(outboxPostTransport(sys.dataDir)).run(ok)).toMatchObject({ status: 'executed' });
    expect((await post(ok)).text).toBe('A tighter version of the same post.');
    expect(JSON.parse(readFileSync(path.join(sys.dataDir, 'outbox', 'posts', outboxFiles()[0]!), 'utf8')).text).toBe('A tighter version of the same post.');

    const bad = await approvedPost();
    await sql("update approvals set edited_payload = jsonb_set(payload, '{text}', to_jsonb($2::text)) where id = $1", [bad, 'This will cure your slow site, guaranteed results.']);
    expect(await executorsWith(outboxPostTransport(sys.dataDir)).run(bad)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/medical claim/) });
    expect((await approval(bad)).status).toBe('failed');
    expect((await post(bad)).status).toBe('failed');
    expect(outboxFiles()).toHaveLength(1); // only the good one
    expect((await items('executor_failed')).length).toBe(1);
  });

  it('checks the account again at publish time: an account paused after the approval publishes nothing', async () => {
    const id = await approvedPost();
    await sql("update channel_accounts set health = 'paused' where id = $1", [xAccount]);
    expect(await executorsWith(outboxPostTransport(sys.dataDir)).run(id)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/paused/) });
    expect((await post(id)).status).toBe('failed');
    expect(outboxFiles()).toHaveLength(0);
  });
});

describe('publishing through the browser (S5-2)', () => {
  const driver = (over: Partial<BrowserDriver> = {}): BrowserDriver & { calls: unknown[] } => {
    const calls: unknown[] = [];
    return { calls, publish: async (a) => { calls.push(a); return { finalUrl: 'https://x.test/acme_test/status/123', screenshot: Buffer.from('PNGDATA') }; }, ...over };
  };

  it('publishes through the driver and keeps the screenshot and the final address on the approval', async () => {
    const id = await approvedPost();
    const d = driver();
    expect(await executorsWith(browserPostTransport(sys.dataDir, d)).run(id)).toMatchObject({ status: 'executed' });
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]).toMatchObject({ platform: 'x', handle: '@acme_test', text: expect.stringContaining('clinic booking page') });
    const a = await approval(id);
    expect(a.result).toMatchObject({ transport: 'browser', url: 'https://x.test/acme_test/status/123', screenshot: `screenshots/${id}.png` });
    expect(readFileSync(path.join(sys.dataDir, a.result.screenshot), 'utf8')).toBe('PNGDATA');
    expect((await post(id)).published_url).toBe('https://x.test/acme_test/status/123');
  });

  it('stops when the session has expired: raises one item, leaves the post approved, and publishes after the next release', async () => {
    const id = await approvedPost();
    let expired = true;
    const d = driver({ publish: async () => { if (expired) throw new SessionExpiredError('X asked for a login'); return { finalUrl: 'https://x.test/s/1', screenshot: Buffer.from('p') }; } });
    const ex = executorsWith(browserPostTransport(sys.dataDir, d));
    expect(await ex.run(id)).toMatchObject({ status: 'needs_login' });
    expect(await ex.run(id)).toMatchObject({ status: 'needs_login' });
    expect((await approval(id)).status).toBe('approved'); // not failed, not claimed: nothing was posted
    expect((await post(id)).status).toBe('approved');
    const its = await items('session_expired');
    expect(its).toHaveLength(1); // once, however often it is tried
    expect(its[0]!.body).toMatch(/@acme_test/);
    expired = false;
    const released = await ex.release!();
    expect(released.released).toEqual([id]);
    expect((await approval(id)).status).toBe('executed');
  });

  it('never retries a failed publish: one call, the approval and post failed, an item raised', async () => {
    const id = await approvedPost();
    const calls: unknown[] = [];
    const ex = executorsWith(browserPostTransport(sys.dataDir, { publish: async (a) => { calls.push(a); throw new Error('The page crashed after pressing Post'); } }));
    expect(await ex.run(id)).toMatchObject({ status: 'failed' });
    expect(await ex.run(id)).toMatchObject({ status: 'already_claimed' });
    expect(calls).toHaveLength(1);
    expect(await ex.release!()).toMatchObject({ released: [] });
    expect((await approval(id)).status).toBe('failed');
    expect((await post(id)).status).toBe('failed');
    expect((await items('executor_failed'))[0]!.body).toMatch(/not retried/i);
  });
});

describe('after a restart, and through the gate and the API (S5-2)', () => {
  it('marks a post left mid-publish as failed with an item, and never publishes it again', async () => {
    const id = await approvedPost();
    await sql("update approvals set status = 'executing' where id = $1", [id]);
    await sql("update posts set status = 'publishing' where approval_id = $1", [id]);
    const ex = executorsWith(outboxPostTransport(sys.dataDir));
    const r = await ex.recover();
    expect(r.unknown).toContain(id);
    expect((await approval(id)).status).toBe('failed');
    expect((await post(id)).status).toBe('failed');
    expect((await items('send_unknown'))[0]!.title).toMatch(/post may or may not/i);
    expect(outboxFiles()).toHaveLength(0);
  });

  it('runs approved posts that never ran when the server starts', async () => {
    const id = await approvedPost();
    const r = await executorsWith(outboxPostTransport(sys.dataDir)).recover();
    expect(r.resumed).toContain(id);
    expect((await approval(id)).status).toBe('executed');
  });

  it('is run by the gate when a person approves it, and not when a person rejects it', async () => {
    const executors = executorsWith(outboxPostTransport(sys.dataDir));
    const bus = new Bus();
    const gate = new LocalApprovalGate({ pool: sys.app, workspaceId: ws(), bus, executors });
    const app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), onApprovalDecided: (d) => gate.decided(d) });
    const decide = (id: string, body: unknown) => app.request(`/api/approvals/${id}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const yes = (await callOsTool(store, scope(), 'propose_post', { accountId: xAccount, text: 'Approve me please.' })).match(/as ([0-9a-f-]{36})/)![1]!;
    const no = (await callOsTool(store, scope(), 'propose_post', { accountId: xAccount, text: 'Reject me please.' })).match(/as ([0-9a-f-]{36})/)![1]!;
    expect((await decide(no, { approved: false })).status).toBe(200);
    expect((await post(no)).status).toBe('rejected'); // the post follows the decision
    expect((await decide(yes, { approved: true })).status).toBe(200);
    for (let i = 0; i < 40 && (await approval(yes)).status !== 'executed'; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await approval(yes)).status).toBe('executed');
    expect((await post(yes)).status).toBe('published');
    expect(outboxFiles()).toHaveLength(1);
  });

  it('lets a person edit only the text of a post when approving, not the account', async () => {
    const executors = executorsWith(outboxPostTransport(sys.dataDir));
    const bus = new Bus();
    const gate = new LocalApprovalGate({ pool: sys.app, workspaceId: ws(), bus, executors });
    const app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), onApprovalDecided: (d) => gate.decided(d) });
    const decide = (id: string, body: unknown) => app.request(`/api/approvals/${id}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const id = (await callOsTool(store, scope(), 'propose_post', { accountId: xAccount, text: 'First draft of a post.' })).match(/as ([0-9a-f-]{36})/)![1]!;
    expect((await decide(id, { approved: true, editedPayload: { accountId: '00000000-0000-4000-8000-000000000000' } })).status).toBe(400);
    expect((await decide(id, { approved: true, editedPayload: { text: '' } })).status).toBe(400);
    expect((await decide(id, { approved: true, editedPayload: { text: 'Second, better draft.' } })).status).toBe(200);
    for (let i = 0; i < 40 && (await approval(id)).status !== 'executed'; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await post(id)).text).toBe('Second, better draft.');
  });

  it('marks the post expired when its approval expires', async () => {
    const id = await approvedPost();
    await sql("update approvals set status = 'pending' where id = $1", [id]);
    const bus = new Bus();
    const gate = new LocalApprovalGate({ pool: sys.app, workspaceId: ws(), bus, executors: executorsWith(outboxPostTransport(sys.dataDir)), timeoutMs: 50 });
    await gate.requested(id);
    for (let i = 0; i < 40 && (await approval(id)).status !== 'expired'; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await approval(id)).status).toBe('expired');
    expect((await post(id)).status).toBe('expired');
    gate.stop();
  });
});
