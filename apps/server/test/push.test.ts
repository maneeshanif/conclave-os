import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { createNotifier, ensureVapidKeys, PUSH_MESSAGES, type PushSender, type Subscription } from '../src/push';
import { REPO_ROOT } from '../src/paths';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

class FakeSender implements PushSender {
  sent: { endpoint: string; payload: string }[] = [];
  outcome: 'ok' | 'gone' | 'error' = 'ok';
  async send(sub: Subscription, payload: string) {
    this.sent.push({ endpoint: sub.endpoint, payload });
    if (this.outcome === 'gone') return { ok: false as const, gone: true };
    if (this.outcome === 'error') return { ok: false as const, gone: false, error: 'push service unavailable' };
    return { ok: true as const };
  }
}
const sub = (n: number) => ({ endpoint: `https://push.example.test/send/${n}`, keys: { p256dh: `p256dh-key-${n}`, auth: `auth-secret-${n}` } });
let sender = new FakeSender();
let notifier = createNotifier({ pool: undefined as never, workspaceId: '', sender });
const approval = async (kind = 'email.send', payload: unknown = { to: 'dana@clinic.test', subject: 'Hello', body: 'LEAD-PRIVATE-BODY' }) =>
  (await sql("insert into approvals (workspace_id, kind, dedupe_key, payload) values ($1, $2, $3, $4) returning id", [ws(), kind, `k-${Math.random()}`, JSON.stringify(payload)])).rows[0].id as string;

beforeAll(async () => {
  ({ sys } = await testSystem());
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from push_events');
  await sql('delete from push_subscriptions');
  sender = new FakeSender();
  notifier = createNotifier({ pool: sys.app, workspaceId: ws(), sender });
});
const subscribe = (n = 1) => notifier.subscribe(sub(n), 'test browser');

describe('the keys (S5-10)', () => {
  it('are made once, kept in the data folder with the secrets, never in the repo, and never printed', () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const a = ensureVapidKeys(sys.dataDir);
    const b = ensureVapidKeys(sys.dataDir);
    expect(b).toEqual(a);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const file = path.join(sys.dataDir, 'secrets', 'vapid.json');
    expect(existsSync(file)).toBe(true);
    expect(path.relative(REPO_ROOT, file).startsWith('..')).toBe(true);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ publicKey: a.publicKey, privateKey: a.privateKey });
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(a.privateKey);
      s.mockRestore();
    }
    expect(JSON.stringify({ publicKey: a.publicKey })).not.toContain(a.privateKey);
  });
});

describe('subscriptions (S5-10)', () => {
  it('are stored once per device, however often the browser says so, and can be removed', async () => {
    await subscribe(1);
    await subscribe(1);
    await subscribe(2);
    expect((await sql('select count(*)::int as n from push_subscriptions')).rows[0].n).toBe(2);
    await notifier.unsubscribe(sub(1).endpoint);
    expect((await sql('select endpoint from push_subscriptions')).rows.map((r) => r.endpoint)).toEqual([sub(2).endpoint]);
  });

  it('refuse an address that is not https, and keys that are missing', async () => {
    await expect(notifier.subscribe({ endpoint: 'http://push.example.test/x', keys: sub(1).keys }, '')).rejects.toThrow(/https/);
    await expect(notifier.subscribe({ endpoint: sub(1).endpoint, keys: { p256dh: '', auth: '' } }, '')).rejects.toThrow(/keys/);
  });
});

describe('the three notifications, and nothing else (S5-10)', () => {
  it('sends an approval waiting to every device, once, however often it is asked', async () => {
    await subscribe(1);
    await subscribe(2);
    const id = await approval();
    await notifier.notify('approval_waiting', id);
    await notifier.notify('approval_waiting', id);
    expect(sender.sent).toHaveLength(2); // two devices, one notification each
    expect(JSON.parse(sender.sent[0]!.payload)).toEqual(PUSH_MESSAGES.approval_waiting);
    expect(PUSH_MESSAGES.approval_waiting.url).toBe('/approvals');
    await notifier.notify('approval_waiting', await approval()); // a different approval is a new notification
    expect(sender.sent).toHaveLength(4);
  });

  it('sends a failed executor and the morning brief, each to its own page, once', async () => {
    await subscribe(1);
    await notifier.notify('executor_failed', 'a1');
    await notifier.notify('executor_failed', 'a1');
    await notifier.notify('brief', '2026-11-13');
    await notifier.notify('brief', '2026-11-13');
    const bodies = sender.sent.map((s) => JSON.parse(s.payload));
    expect(bodies).toEqual([PUSH_MESSAGES.executor_failed, PUSH_MESSAGES.brief]);
    expect(PUSH_MESSAGES.executor_failed.url).toBe('/action-items');
    expect(PUSH_MESSAGES.brief.url).toBe('/brief');
  });

  it('carries no text from a post, a lead or a message: only a fixed title, line, page and tag', async () => {
    await subscribe(1);
    const id = await approval('post.publish', { text: 'SECRET-POST-TEXT about the clinic', platform: 'x', handle: '@acme' });
    const lead = await approval('email.send', { to: 'dana@clinic.test', subject: 'LEAD-SUBJECT', body: 'LEAD-PRIVATE-BODY' });
    await notifier.notify('approval_waiting', id);
    await notifier.notify('approval_waiting', lead);
    await notifier.notify('executor_failed', id);
    for (const s of sender.sent) {
      expect(Object.keys(JSON.parse(s.payload)).sort()).toEqual(['body', 'tag', 'title', 'url']);
      for (const secret of ['SECRET-POST-TEXT', 'LEAD-SUBJECT', 'LEAD-PRIVATE-BODY', 'dana@clinic.test', '@acme']) expect(s.payload).not.toContain(secret);
    }
    for (const m of Object.values(PUSH_MESSAGES)) expect(m.body.length).toBeLessThan(80);
  });

  it('does not send for anything else: a task, a run, an approval that was approved, rejected or executed', async () => {
    await subscribe(1);
    const bus = new Bus();
    const detach = notifier.attach(bus);
    bus.publish({ kind: 'task.changed', workspaceId: ws(), taskId: 't' });
    bus.publish({ kind: 'run.state', workspaceId: ws(), runId: 'r', taskId: 't', status: 'failed', error: 'x' });
    for (const status of ['approved', 'rejected', 'executed', 'expired', 'executing']) bus.publish({ kind: 'approval.changed', workspaceId: ws(), approvalId: `a-${status}`, status });
    bus.publish({ kind: 'settings.changed', workspaceId: ws() });
    await new Promise((r) => setTimeout(r, 100));
    expect(sender.sent).toHaveLength(0);
    bus.publish({ kind: 'approval.changed', workspaceId: ws(), approvalId: 'a-failed', status: 'failed' });
    await new Promise((r) => setTimeout(r, 200));
    expect(sender.sent).toHaveLength(1);
    expect(JSON.parse(sender.sent[0]!.payload)).toEqual(PUSH_MESSAGES.executor_failed);
    detach();
    bus.publish({ kind: 'approval.changed', workspaceId: ws(), approvalId: 'a-failed-2', status: 'failed' });
    await new Promise((r) => setTimeout(r, 100));
    expect(sender.sent).toHaveLength(1);
  });

  it('does nothing, and records nothing, when there is no device to tell... but still counts the event as handled once', async () => {
    const r = await notifier.notify('brief', '2026-11-13');
    expect(r.sent).toBe(0);
    await subscribe(1);
    await notifier.notify('brief', '2026-11-13'); // already handled: a device added later is not sent yesterday's news
    expect(sender.sent).toHaveLength(0);
  });
});

describe('devices that stop answering (S5-10)', () => {
  it('removes a subscription the push service says is gone', async () => {
    await subscribe(1);
    await subscribe(2);
    sender.outcome = 'gone';
    await notifier.notify('brief', '2026-11-14');
    expect((await sql('select count(*)::int as n from push_subscriptions')).rows[0].n).toBe(0);
  });

  it('keeps a subscription through a passing error, counts the failure, and drops it after five in a row', async () => {
    await subscribe(1);
    sender.outcome = 'error';
    for (let i = 0; i < 4; i++) await notifier.notify('brief', `d${i}`);
    expect((await sql('select failures from push_subscriptions')).rows[0].failures).toBe(4);
    await notifier.notify('brief', 'd4');
    expect((await sql('select count(*)::int as n from push_subscriptions')).rows[0].n).toBe(0);
    await subscribe(1);
    sender.outcome = 'ok';
    await notifier.notify('brief', 'd5');
    expect((await sql('select failures from push_subscriptions')).rows[0].failures).toBe(0);
  });

  it('never lets a failing device stop the others from being told, or throw into the caller', async () => {
    await subscribe(1);
    await subscribe(2);
    const flaky: PushSender = { send: async (s) => { if (s.endpoint.endsWith('/1')) throw new Error('network down'); return { ok: true as const }; } };
    const n = createNotifier({ pool: sys.app, workspaceId: ws(), sender: flaky });
    await expect(n.notify('brief', 'd9')).resolves.toMatchObject({ sent: 1 });
  });
});

describe('the push API (S5-10)', () => {
  const app = () => createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), push: { notifier, publicKey: ensureVapidKeys(sys.dataDir).publicKey } });
  const post = (a: ReturnType<typeof app>, p: string, body: unknown, method = 'POST') => a.request(`/api/push${p}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('gives the public key and never the private one', async () => {
    const a = app();
    const res = await a.request('/api/push/key');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ publicKey: ensureVapidKeys(sys.dataDir).publicKey });
    expect(text).not.toContain(ensureVapidKeys(sys.dataDir).privateKey);
  });

  it('stores a subscription once, refuses a bad one, and removes one on request', async () => {
    const a = app();
    expect((await post(a, '/subscribe', sub(1))).status).toBe(201);
    expect((await post(a, '/subscribe', sub(1))).status).toBe(201);
    expect((await sql('select count(*)::int as n from push_subscriptions')).rows[0].n).toBe(1);
    expect((await post(a, '/subscribe', { endpoint: 'http://insecure.test/x', keys: sub(1).keys })).status).toBe(400);
    expect((await post(a, '/subscribe', { endpoint: sub(3).endpoint })).status).toBe(400);
    expect((await post(a, '/subscribe', { endpoint: sub(1).endpoint }, 'DELETE')).status).toBe(200);
    expect((await sql('select count(*)::int as n from push_subscriptions')).rows[0].n).toBe(0);
  });
});
