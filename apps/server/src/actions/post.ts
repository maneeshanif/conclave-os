import { z } from 'zod';
import { withWorkspace } from '../db/tenant';
import { checkPost, hashText, isPostPlatform } from '../posts';
import { readSettings } from '../settings';
import type { ExecResult, ExecutorDeps } from './email';
import { companyMarkdown } from './policy';
import { markSession } from '../browser/profiles';
import { SessionExpiredError } from './post-transport';

export const PostPayload = z.object({
  platform: z.string(),
  handle: z.string(),
  accountId: z.uuid(),
  text: z.string().trim().min(1).max(5000),
});

export type PostExecResult = ExecResult | { status: 'needs_login'; reason: string };

/**
 * The post executor (SPEC 6, 8). Plain code, no model. It claims the approval once (`approved` to `executing`), checks
 * everything again against the world as it is now, publishes the exact approved text through the transport, and records the
 * result on the approval. A publish is never retried. The one exception is a login that has expired: nothing was posted, so
 * the approval goes back to `approved`, one action item says so, and it goes out when a person has logged in again.
 */
export async function executePost(deps: ExecutorDeps, approvalId: string): Promise<PostExecResult> {
  const ws = deps.workspaceId;
  const now = deps.now ?? (() => new Date());

  const claim = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if ((await readSettings(c, ws)).killSwitch) return { kind: 'kill_switch' as const };
    const r = await c.query<{ payload: unknown; edited_payload: unknown }>(
      "update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'post.publish' returning payload, edited_payload",
      [approvalId],
    );
    if (!r.rows[0]) return { kind: 'none' as const };
    await c.query("update posts set status = 'publishing' where approval_id = $1", [approvalId]);
    return { kind: 'claimed' as const, row: r.rows[0] };
  });
  if (claim.kind === 'kill_switch') return { status: 'kill_switch' };
  if (claim.kind === 'none') return { status: 'already_claimed' };

  const finish = async (status: 'executed' | 'failed', post: 'published' | 'failed', result: Record<string, unknown>, extra: { url?: string; text?: string; item?: { kind: string; title: string; body: string } } = {}) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, status, JSON.stringify(result)]);
      await c.query(
        `update posts set status = $2, published_url = $3, published_at = case when $2 = 'published' then now() else published_at end, error = $4,
                text = coalesce($5, text), text_hash = coalesce($6, text_hash) where approval_id = $1`,
        [approvalId, post, extra.url ?? null, post === 'failed' ? String(result.reason ?? '') : null, extra.text ?? null, extra.text ? hashText(extra.text) : null],
      );
      if (extra.item) await c.query('insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, $2, $3, $4, $5) on conflict do nothing', [ws, extra.item.kind, extra.item.title, extra.item.body, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:post', $2, $3, $4)", [ws, `approval.${status}`, approvalId, JSON.stringify(result)]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status });
  };

  const parsed = PostPayload.safeParse({ ...(claim.row.payload as object), ...((claim.row.edited_payload as object | null) ?? {}) });
  const refuse = async (reason: string, title = 'A post was not published'): Promise<PostExecResult> => {
    await finish('failed', 'failed', { reason }, { item: { kind: 'executor_failed', title, body: reason } });
    return { status: 'refused', reason };
  };
  if (!parsed.success) return refuse(`bad payload: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  const p = parsed.data;

  // The world can change between the proposal and the approval, so everything is checked again here.
  const acct = await withWorkspace(deps.pool, ws, async ({ client: c }) => (await c.query<{ channel: string; handle: string; health: string; transport: string; session_state: string }>('select channel, handle, health, transport, session_state from channel_accounts where id = $1', [p.accountId])).rows[0]);
  if (!acct) return refuse('the account no longer exists');
  if (!isPostPlatform(acct.channel)) return refuse(`${acct.handle} is not a posting account`);
  if (acct.health !== 'ok') return refuse(`the account ${acct.handle} is ${acct.health}`);
  const check = checkPost(acct.channel, p.text, await companyMarkdown(deps.companyRoot));
  if (!check.ok) return refuse(`blocked: ${check.reasons.join('; ')}`);
  // The account says how its posts go out. The browser is only used for an account switched to it.
  const viaBrowser = acct.transport === 'browser';
  const transport = viaBrowser ? deps.browserPostTransport : deps.postTransport;
  if (!transport) return refuse(viaBrowser ? `${acct.handle} is set to publish through the browser, but this server has no browser transport` : 'there is no way to publish configured on this server');

  try {
    // A browser that is not known to be logged in is not opened at all.
    if (viaBrowser && acct.session_state !== 'valid') throw new SessionExpiredError(`the saved login is ${acct.session_state}`);
    const out = await transport.publish({ approvalId, platform: acct.channel, handle: acct.handle, accountId: p.accountId, text: p.text });
    await finish('executed', 'published', { ref: out.ref, url: out.url, transport: transport.name, ...(out.screenshot ? { screenshot: out.screenshot } : {}), publishedAt: now().toISOString() }, { url: out.url, text: p.text });
    return { status: 'executed', ref: out.ref };
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      const reason = `${acct.handle}'s login has expired (${err.message}). Log in again, then press "send the approved ones".`;
      await withWorkspace(deps.pool, ws, async ({ client: c }) => {
        await markSession(c, ws, p.accountId, 'expired', 'executor:post');
        await c.query("update approvals set status = 'approved' where id = $1 and status = 'executing'", [approvalId]);
        await c.query("update posts set status = 'approved' where approval_id = $1", [approvalId]);
      });
      return { status: 'needs_login', reason };
    }
    const reason = (err as Error).message;
    await finish('failed', 'failed', { reason, transport: transport.name }, { item: { kind: 'executor_failed', title: `A post to ${acct.handle} failed while publishing`, body: `${reason}\nIt was not retried. Check the account before approving a new copy.` } });
    return { status: 'failed', reason };
  }
}

/**
 * On server start: a post left `executing` may or may not have gone out, so it is never published again; it is marked failed
 * and raised to a person. Approved posts that never ran are published now, in the order they were decided.
 */
export async function recoverPosts(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    approved: (await c.query<{ id: string }>("select id from approvals where kind = 'post.publish' and status = 'approved' order by decided_at, id")).rows.map((r) => r.id),
    executing: (await c.query<{ id: string }>("select id from approvals where kind = 'post.publish' and status = 'executing'")).rows.map((r) => r.id),
  }));
  for (const id of executing) {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query("update approvals set status = 'failed', result = $2 where id = $1 and status = 'executing'", [id, JSON.stringify({ reason: 'interrupted while publishing; outcome unknown' })]);
      await c.query("update posts set status = 'failed', error = 'interrupted while publishing; outcome unknown' where approval_id = $1", [id]);
      await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'send_unknown', 'A post may or may not have been published', 'The server stopped while this post was being published. It was not published again. Check the account before approving a new copy.', $2) on conflict do nothing", [ws, id]);
    });
  }
  for (const id of approved) await executePost(deps, id);
  return { resumed: approved, unknown: executing };
}

/** Publishes the approved posts that something was holding (the kill switch, an expired login), in the order they were decided. */
export async function releasePosts(deps: ExecutorDeps): Promise<string[]> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string }>("select id from approvals where kind = 'post.publish' and status = 'approved' order by decided_at, id"));
  const released: string[] = [];
  for (const { id } of ids.rows) if ((await executePost(deps, id)).status === 'executed') released.push(id);
  return released;
}
