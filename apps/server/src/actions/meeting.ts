import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withWorkspace } from '../db/tenant';
import { newGuestToken } from '../meetings/guest';
import { readSettings } from '../settings';
import type { ExecResult, ExecutorDeps } from './email';

/**
 * The `meeting.invite` executor (S10-1, SPEC 10). Plain code, no model. After a person approves an invite it claims once, makes one guest link
 * for the meeting (only the hash is stored), and writes the invite, with the link, to the invites folder, the way the email outbox sends
 * nothing by itself. The token exists in that one file and nowhere else. An invite is never made twice: after a restart, one left executing is
 * failed with a note and a new invite is asked for.
 */
interface Payload {
  meetingId: string;
  to: string;
  ttlHours: number;
}

const BASE = () => (process.env.GUEST_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');

export async function executeMeetingInvite(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const claim = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if ((await readSettings(c, ws)).killSwitch) return { kind: 'kill_switch' as const };
    const r = await c.query<{ payload: Payload }>("update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'meeting.invite' returning payload", [approvalId]);
    return r.rows[0] ? { kind: 'claimed' as const, payload: r.rows[0].payload } : { kind: 'none' as const };
  });
  if (claim.kind === 'kill_switch') return { status: 'kill_switch' };
  if (claim.kind === 'none') return { status: 'already_claimed' };
  const p = claim.payload;
  const finish = async (ok: boolean, result: Record<string, unknown>) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, ok ? 'executed' : 'failed', JSON.stringify(result)]);
      if (!ok) await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', 'A meeting invite was not made', $2, $3) on conflict do nothing", [ws, `${String(result.reason)}\nAsk for a new invite if you still want one.`, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:meeting', $2, $3, $4)", [ws, ok ? 'approval.executed' : 'approval.failed', approvalId, JSON.stringify(result)]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status: ok ? 'executed' : 'failed' });
  };
  const refuse = async (reason: string, status: 'refused' | 'failed' = 'refused'): Promise<ExecResult> => {
    await finish(false, { reason });
    return { status, reason };
  };
  if (!deps.dataDir) return refuse('this server has no data folder to write invites to');
  const m = await withWorkspace(deps.pool, ws, async ({ client: c }) => (await c.query<{ status: string }>('select status from meetings where id = $1', [p.meetingId])).rows[0]);
  if (!m || m.status === 'cancelled' || m.status === 'closed') return refuse('the meeting is gone, cancelled or over');
  try {
    const { token, hash } = newGuestToken(ws);
    await withWorkspace(deps.pool, ws, ({ client: c }) =>
      c.query("insert into guest_links (workspace_id, meeting_id, token_hash, approval_id, expires_at) values ($1, $2, $3, $4, now() + ($5 || ' hours')::interval)", [ws, p.meetingId, hash, approvalId, String(p.ttlHours)]),
    );
    const dir = path.join(deps.dataDir, 'invites');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${approvalId}.json`), JSON.stringify({ to: p.to, url: `${BASE()}/meet/${token}`, expiresInHours: p.ttlHours, note: 'This file is the only place the link exists. Nothing was sent.' }, null, 2) + '\n', { flag: 'wx' });
    await finish(true, { meetingId: p.meetingId, to: p.to });
    return { status: 'executed', ref: `invite:${approvalId}` };
  } catch (err) {
    return refuse((err as Error).message, 'failed');
  }
}

export async function recoverMeetingInvites(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    approved: (await c.query<{ id: string }>("select id from approvals where kind = 'meeting.invite' and status = 'approved' order by decided_at, id")).rows.map((r) => r.id),
    executing: (await c.query<{ id: string }>("select id from approvals where kind = 'meeting.invite' and status = 'executing'")).rows.map((r) => r.id),
  }));
  for (const id of executing) await withWorkspace(deps.pool, ws, ({ client: c }) => c.query("update approvals set status = 'failed', result = $2 where id = $1 and status = 'executing'", [id, JSON.stringify({ reason: 'interrupted; ask for a new invite' })]));
  const resumed: string[] = [];
  for (const id of approved) if ((await executeMeetingInvite(deps, id)).status === 'executed') resumed.push(id);
  return { resumed, unknown: executing };
}

export async function releaseMeetingInvites(deps: ExecutorDeps): Promise<string[]> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string }>("select id from approvals where kind = 'meeting.invite' and status = 'approved' order by decided_at, id"));
  const out: string[] = [];
  for (const { id } of ids.rows) if ((await executeMeetingInvite(deps, id)).status === 'executed') out.push(id);
  return out;
}
