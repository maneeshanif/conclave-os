import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { createRequire } from 'node:module';
import type { Bus } from '../bus';
import { withWorkspace } from '../db/tenant';

// web-push is a CommonJS package; loading it this way works the same under the server and the tests.
const webpush = createRequire(import.meta.url)('web-push') as typeof import('web-push');

/**
 * Push notifications for the installed app (SPEC 12): three events only, the morning brief, a failed executor and an approval
 * waiting. Each is sent once. The message is fixed text and a page to open: nothing from a post, a lead or a message ever goes in
 * it, because a push passes through the browser vendor's servers.
 */
export type PushKind = 'approval_waiting' | 'executor_failed' | 'brief';

export const PUSH_MESSAGES: Record<PushKind, { title: string; body: string; url: string; tag: string }> = {
  approval_waiting: { title: 'An approval is waiting', body: 'Open Conclave OS to decide.', url: '/approvals', tag: 'approval' },
  executor_failed: { title: 'Something did not go out', body: 'An action failed and needs a look.', url: '/action-items', tag: 'failed' },
  brief: { title: 'Your morning brief is ready', body: 'Open it to see the day.', url: '/brief', tag: 'brief' },
};

export interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushSender {
  send(sub: Subscription, payload: string): Promise<{ ok: true } | { ok: false; gone: boolean; error?: string }>;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** The keys that identify this server to push services. Made on first use and kept with the other secrets, never in the repo, never logged. */
export function ensureVapidKeys(dataDir: string): VapidKeys {
  const file = path.join(dataDir, 'secrets', 'vapid.json');
  if (existsSync(file)) {
    const k = JSON.parse(readFileSync(file, 'utf8')) as VapidKeys;
    if (k.publicKey && k.privateKey) return { publicKey: k.publicKey, privateKey: k.privateKey };
  }
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows has no such modes; the data folder is the protection there.
  }
  return keys;
}

/** The real sender (Web Push, signed with the VAPID keys). Not run by any automated test: it talks to browser vendors' servers. */
export function webPushSender(keys: VapidKeys, subject: string): PushSender {
  return {
    async send(sub, payload) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 3600, vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey } });
        return { ok: true };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return { ok: false, gone: status === 404 || status === 410, error: (err as Error).message.slice(0, 200) };
      }
    },
  };
}

const MAX_FAILURES = 5;

export function createNotifier(o: { pool: pg.Pool; workspaceId: string; sender: PushSender }) {
  const { pool, workspaceId: ws, sender } = o;

  async function subscribe(sub: Subscription, userAgent: string): Promise<void> {
    if (!/^https:\/\//i.test(sub.endpoint) || !URL.canParse(sub.endpoint)) throw new Error('The subscription address must be an https address.');
    if (!sub.keys?.p256dh || !sub.keys?.auth) throw new Error('The subscription is missing its keys.');
    await withWorkspace(pool, ws, ({ client: c }) =>
      c.query(
        `insert into push_subscriptions (workspace_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5)
         on conflict (workspace_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, failures = 0`,
        [ws, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent.slice(0, 200)],
      ),
    );
  }

  async function unsubscribe(endpoint: string): Promise<void> {
    await withWorkspace(pool, ws, ({ client: c }) => c.query('delete from push_subscriptions where endpoint = $1', [endpoint]));
  }

  /** Sends one notification to every device, once per (kind, ref) however often it is asked. Never throws. */
  async function notify(kind: PushKind, ref: string): Promise<{ sent: number }> {
    const subs = await withWorkspace(pool, ws, async ({ client: c }) => {
      const first = await c.query('insert into push_events (workspace_id, kind, ref) values ($1, $2, $3) on conflict (workspace_id, kind, ref) do nothing returning id', [ws, kind, ref]);
      if (!first.rows[0]) return null;
      return (await c.query<{ id: string; endpoint: string; p256dh: string; auth: string }>('select id, endpoint, p256dh, auth from push_subscriptions order by created_at')).rows;
    });
    if (!subs) return { sent: 0 };
    const payload = JSON.stringify(PUSH_MESSAGES[kind]);
    let sent = 0;
    for (const s of subs) {
      let r: Awaited<ReturnType<PushSender['send']>>;
      try {
        r = await sender.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (err) {
        r = { ok: false, gone: false, error: (err as Error).message };
      }
      await withWorkspace(pool, ws, async ({ client: c }) => {
        if (r.ok) await c.query('update push_subscriptions set failures = 0, last_ok_at = now() where id = $1', [s.id]);
        else if (r.gone) await c.query('delete from push_subscriptions where id = $1', [s.id]);
        else {
          const u = await c.query<{ failures: number }>('update push_subscriptions set failures = failures + 1 where id = $1 returning failures', [s.id]);
          if ((u.rows[0]?.failures ?? 0) >= MAX_FAILURES) await c.query('delete from push_subscriptions where id = $1', [s.id]);
        }
      }).catch(() => undefined);
      if (r.ok) sent++;
    }
    await withWorkspace(pool, ws, ({ client: c }) => c.query('update push_events set sent = $4 where kind = $1 and ref = $2 and workspace_id = $3', [kind, ref, ws, sent])).catch(() => undefined);
    return { sent };
  }

  /** Listens for a failed executor on the bus. An approval that was approved, rejected, expired or executed is not news. */
  function attach(bus: Bus, onError: (err: unknown) => void = (err) => console.error('push:', err)): () => void {
    return bus.subscribe((m) => {
      if (m.kind === 'approval.changed' && m.workspaceId === ws && m.status === 'failed') void notify('executor_failed', m.approvalId).catch(onError);
    });
  }

  return { subscribe, unsubscribe, notify, attach };
}
export type Notifier = ReturnType<typeof createNotifier>;
