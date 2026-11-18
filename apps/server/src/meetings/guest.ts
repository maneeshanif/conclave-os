import { createHash, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type pg from 'pg';
import { withWorkspace } from '../db/tenant';

/**
 * Guest links (S10-1, SPEC 10, 12). A client opens a link with no account. The link is `<workspace id>.<secret>`: the workspace id is not a
 * secret (it only says where to look), the secret is 32 random bytes, and only its SHA-256 is stored, so no table, log or approval can give a
 * link back. Opening a link shows a guest the title and the time of one meeting and nothing else. A link expires, can be revoked, and ends
 * when its meeting is cancelled or closed. The OS itself never becomes public: `guestRoutes` is a separate small app, and putting it on a
 * network is a choice a person makes, behind the media side (SPEC 12), not something mounted by default.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** A new link for a workspace: the whole token to hand to the guest, and the hash to keep. */
export function newGuestToken(workspaceId: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { token: `${workspaceId}.${secret}`, hash: hashSecret(secret) };
}

export interface GuestMeeting {
  meetingId: string;
  title: string;
  startsAt: string;
}

/** Opens a link: the meeting it is for, or null for anything that is not a live link. Each opening is counted. */
export async function openGuestLink(pool: pg.Pool, token: string): Promise<GuestMeeting | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [workspaceId, secret] = parts as [string, string];
  if (!UUID.test(workspaceId) || !SECRET.test(secret)) return null;
  return withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const r = await c.query<{ id: string; meeting_id: string; title: string; starts_at: Date }>(
      `select g.id, g.meeting_id, m.title, m.starts_at from guest_links g join meetings m on m.id = g.meeting_id and m.workspace_id = g.workspace_id
        where g.token_hash = $1 and g.revoked_at is null and g.expires_at > now() and m.status in ('planned','open')`,
      [hashSecret(secret)],
    );
    const row = r.rows[0];
    if (!row) return null;
    await c.query('update guest_links set used_count = used_count + 1 where id = $1', [row.id]);
    return { meetingId: row.meeting_id, title: row.title, startsAt: row.starts_at.toISOString() };
  }).catch(() => null);
}

export async function revokeGuestLink(pool: pg.Pool, workspaceId: string, linkId: string): Promise<void> {
  await withWorkspace(pool, workspaceId, ({ client: c }) => c.query('update guest_links set revoked_at = now() where id = $1 and revoked_at is null', [linkId]));
}

/** What a guest can reach: one read, `GET /:token`, answering the title and the time. Everything else is not found. */
export function guestRoutes(deps: { pool: pg.Pool }) {
  const app = new Hono();
  app.get('/:token', async (c) => {
    const m = await openGuestLink(deps.pool, c.req.param('token'));
    if (!m) return c.json({ error: 'This link is not valid.' }, 404);
    return c.json({ title: m.title, startsAt: m.startsAt });
  });
  app.all('*', (c) => c.json({ error: 'Not found.' }, 404));
  return app;
}
