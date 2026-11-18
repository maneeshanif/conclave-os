import { withWorkspace } from '../db/tenant';
import { readSettings } from '../settings';
import type { ChannelConnector } from './channel-connector';
import type { ExecResult, ExecutorDeps } from './email';

/**
 * The `channel.reply` executor (S10-6). Plain code, no model. After a person approves a reply it claims once and hands exactly that reply to the
 * channel connector. With none set up it refuses and says so. A reply is never retried: a second one is a second message to a client.
 */
interface Payload {
  messageId: string;
  channel: string;
  to: string;
  text: string;
}

export async function executeChannelReply(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const claim = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if ((await readSettings(c, ws)).killSwitch) return { kind: 'kill_switch' as const };
    const r = await c.query<{ payload: Payload }>("update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'channel.reply' returning payload", [approvalId]);
    return r.rows[0] ? { kind: 'claimed' as const, payload: r.rows[0].payload } : { kind: 'none' as const };
  });
  if (claim.kind === 'kill_switch') return { status: 'kill_switch' };
  if (claim.kind === 'none') return { status: 'already_claimed' };
  const p = claim.payload;
  const finish = async (ok: boolean, result: Record<string, unknown>) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, ok ? 'executed' : 'failed', JSON.stringify(result)]);
      if (ok) await c.query("update channel_messages set status = 'replied' where id = $1", [p.messageId]);
      else await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', 'A reply to a client was not sent', $2, $3) on conflict do nothing", [ws, `${String(result.reason)}\nIt was not retried.`, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:channel', $2, $3, $4)", [ws, ok ? 'approval.executed' : 'approval.failed', approvalId, JSON.stringify({ ...result, channel: p.channel })]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status: ok ? 'executed' : 'failed' });
  };
  const connector: ChannelConnector | undefined = deps.channelConnector;
  if (!connector) {
    const reason = 'there is no channel connector set up on this server';
    await finish(false, { reason });
    return { status: 'refused', reason };
  }
  try {
    const out = await connector.send({ approvalId, channel: p.channel, to: p.to, text: p.text });
    await finish(true, { ref: out.ref, connector: connector.name });
    return { status: 'executed', ref: out.ref };
  } catch (err) {
    const reason = (err as Error).message;
    await finish(false, { reason, connector: connector.name });
    return { status: 'failed', reason };
  }
}

export async function recoverChannelReplies(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    approved: (await c.query<{ id: string }>("select id from approvals where kind = 'channel.reply' and status = 'approved' order by decided_at, id")).rows.map((r) => r.id),
    executing: (await c.query<{ id: string }>("select id from approvals where kind = 'channel.reply' and status = 'executing'")).rows.map((r) => r.id),
  }));
  for (const id of executing) {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query("update approvals set status = 'failed', result = $2 where id = $1 and status = 'executing'", [id, JSON.stringify({ reason: 'interrupted; the outcome is unknown' })]);
      await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'send_unknown', 'A reply to a client may or may not have been sent', 'The server stopped while this reply was being sent. It was not sent again. Check the channel before approving a new copy.', $2) on conflict do nothing", [ws, id]);
    });
  }
  const resumed: string[] = [];
  for (const id of approved) if ((await executeChannelReply(deps, id)).status === 'executed') resumed.push(id);
  return { resumed, unknown: executing };
}

export async function releaseChannelReplies(deps: ExecutorDeps): Promise<string[]> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string }>("select id from approvals where kind = 'channel.reply' and status = 'approved' order by decided_at, id"));
  const out: string[] = [];
  for (const { id } of ids.rows) if ((await executeChannelReply(deps, id)).status === 'executed') out.push(id);
  return out;
}
