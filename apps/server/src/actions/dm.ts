import { z } from 'zod';
import { withWorkspace } from '../db/tenant';
import { checkDm, dmEligible, dmSuppressed, isDmChannel } from '../dms';
import { hashText } from '../posts';
import { readSettings, startOfToday, startOfTomorrow } from '../settings';
import type { ExecResult, ExecutorDeps } from './email';
import { companyMarkdown } from './policy';

export const DmPayload = z.object({
  channel: z.string(),
  handle: z.string(),
  accountId: z.uuid(),
  leadId: z.uuid(),
  recipient: z.string().regex(/^@?[A-Za-z0-9._]{1,50}$/),
  text: z.string().trim().min(1).max(10_000),
});

/** The minimum time between two DMs from one account, so a burst never looks like automation. */
export const DEFAULT_DM_GAP_MS = 90_000;

/**
 * The DM executor (SPEC 15, rule 6). One person per approval. It claims once, and sends one DM at a time per account: while
 * another from the same account is going or went less than the gap ago, or the account's daily limit (the smaller warm-up
 * limit while warming up) is used, the approval stays approved and is reported held, for the gate to try later. Every check
 * runs again at send time. A send is never retried.
 */
export async function executeDm(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const now = deps.now ?? (() => new Date());
  const gapMs = deps.dmGapMs ?? DEFAULT_DM_GAP_MS;

  const claim = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    const settings = await readSettings(c, ws);
    if (settings.killSwitch) return { kind: 'kill_switch' as const };
    const mine = await c.query<{ payload: { accountId?: string } }>("select payload from approvals where id = $1 and status = 'approved' and kind = 'dm.send' for update", [approvalId]);
    if (!mine.rows[0]) return { kind: 'none' as const };
    const accountId = mine.rows[0].payload?.accountId;
    if (accountId) {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`dm-send:${ws}:${accountId}`]);
      const a = (await c.query<{ handle: string; health: string; daily_cap: number; warmup_until: Date | null; warmup_cap: number }>('select handle, health, daily_cap, warmup_until, warmup_cap from channel_accounts where id = $1', [accountId])).rows[0];
      // An account that is gone or unhealthy is claimed and refused below with the reason, not held for ever.
      if (a && a.health === 'ok') {
        const t = now();
        const warming = a.warmup_until !== null && a.warmup_until >= startOfToday(t);
        const cap = warming ? Math.min(a.warmup_cap, a.daily_cap) : a.daily_cap;
        const u = (
          await c.query<{ used: number; last: Date | null }>(
            "select count(*) filter (where coalesce(sent_at, claimed_at) >= $2)::int as used, max(coalesce(sent_at, claimed_at)) as last from dms where channel_account_id = $1 and status in ('sent','sending')",
            [accountId, startOfToday(t)],
          )
        ).rows[0]!;
        if (u.used >= cap) return { kind: 'held' as const, hold: { status: 'held' as const, reason: `${a.handle}'s daily limit of ${cap} DMs is reached${warming ? ' (it is still warming up)' : ''}`, until: startOfTomorrow(t) } };
        if (u.last && t.getTime() - u.last.getTime() < gapMs) return { kind: 'held' as const, hold: { status: 'held' as const, reason: `one DM at a time: the last one from ${a.handle} went less than ${Math.round(gapMs / 1000)} seconds ago`, until: new Date(u.last.getTime() + gapMs) } };
      }
    }
    const r = await c.query<{ payload: unknown; edited_payload: unknown }>("update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'dm.send' returning payload, edited_payload", [approvalId]);
    if (!r.rows[0]) return { kind: 'none' as const };
    await c.query("update dms set status = 'sending', claimed_at = $2 where approval_id = $1", [approvalId, now()]);
    return { kind: 'claimed' as const, row: r.rows[0] };
  });
  if (claim.kind === 'kill_switch') return { status: 'kill_switch' };
  if (claim.kind === 'held') return claim.hold;
  if (claim.kind === 'none') return { status: 'already_claimed' };

  const finish = async (status: 'executed' | 'failed', dm: 'sent' | 'failed', result: Record<string, unknown>, extra: { text?: string; item?: { kind: string; title: string; body: string } } = {}) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, status, JSON.stringify(result)]);
      await c.query("update dms set status = $2, sent_at = case when $2 = 'sent' then $3::timestamptz else sent_at end, error = $4, text = coalesce($5, text), text_hash = coalesce($6, text_hash) where approval_id = $1", [
        approvalId,
        dm,
        now(),
        dm === 'failed' ? String(result.reason ?? '') : null,
        extra.text ?? null,
        extra.text ? hashText(extra.text) : null,
      ]);
      if (extra.item) await c.query('insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, $2, $3, $4, $5) on conflict do nothing', [ws, extra.item.kind, extra.item.title, extra.item.body, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:dm', $2, $3, $4)", [ws, `approval.${status}`, approvalId, JSON.stringify(result)]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status });
  };
  const parsed = DmPayload.safeParse({ ...(claim.row.payload as object), ...((claim.row.edited_payload as object | null) ?? {}) });
  const refuse = async (reason: string): Promise<ExecResult> => {
    await finish('failed', 'failed', { reason }, { item: { kind: 'executor_failed', title: 'A direct message was not sent', body: reason } });
    return { status: 'refused', reason };
  };
  if (!parsed.success) return refuse(`bad payload: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  const p = parsed.data;

  const state = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    acct: (await c.query<{ channel: string; handle: string; health: string }>('select channel, handle, health from channel_accounts where id = $1', [p.accountId])).rows[0],
    lead: (await c.query<{ stage: string; email: string | null }>('select stage, email from leads where id = $1', [p.leadId])).rows[0],
    suppressed: (await c.query<{ value: string }>('select value from suppression')).rows.map((r) => r.value),
  }));
  if (!state.acct) return refuse('the account no longer exists');
  if (!isDmChannel(state.acct.channel)) return refuse(`${state.acct.handle} is not a direct-message account`);
  if (state.acct.health !== 'ok') return refuse(`the account ${state.acct.handle} is ${state.acct.health}`);
  if (!state.lead) return refuse('the lead no longer exists');
  if (state.lead.stage === 'do_not_contact') return refuse('the lead is marked do not contact');
  if (!dmEligible(state.lead.stage)) return refuse('the lead is no longer in a stage where a DM may follow');
  if (dmSuppressed(p.recipient, state.lead.email, state.suppressed)) return refuse('the recipient is on the suppression list');
  const check = checkDm(state.acct.channel, p.text, await companyMarkdown(deps.companyRoot));
  if (!check.ok) return refuse(`blocked: ${check.reasons.join('; ')}`);
  const transport = deps.dmTransport;
  if (!transport) return refuse('there is no way to send direct messages configured on this server');

  try {
    const out = await transport.send({ approvalId, channel: state.acct.channel, handle: state.acct.handle, recipient: p.recipient, text: p.text });
    await finish('executed', 'sent', { ref: out.ref, transport: transport.name, recipient: p.recipient }, { text: p.text });
    return { status: 'executed', ref: out.ref };
  } catch (err) {
    const reason = (err as Error).message;
    await finish('failed', 'failed', { reason, transport: transport.name }, { item: { kind: 'executor_failed', title: `A direct message from ${state.acct.handle} failed while sending`, body: `${reason}\nIt was not retried. Check the account before approving a new copy.` } });
    return { status: 'failed', reason };
  }
}

/** On start: a DM left `executing` may or may not have gone out, so it is never sent again; approved ones that never ran are tried in order. */
export async function recoverDms(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[]; held: { id: string; until: Date }[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    approved: (await c.query<{ id: string }>("select id from approvals where kind = 'dm.send' and status = 'approved' order by decided_at, id")).rows.map((r) => r.id),
    executing: (await c.query<{ id: string }>("select id from approvals where kind = 'dm.send' and status = 'executing'")).rows.map((r) => r.id),
  }));
  for (const id of executing) {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query("update approvals set status = 'failed', result = $2 where id = $1 and status = 'executing'", [id, JSON.stringify({ reason: 'interrupted while sending; outcome unknown' })]);
      await c.query("update dms set status = 'failed', error = 'interrupted while sending; outcome unknown' where approval_id = $1", [id]);
      await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'send_unknown', 'A direct message may or may not have been sent', 'The server stopped while this message was being sent. It was not sent again. Check the account before approving a new copy.', $2) on conflict do nothing", [ws, id]);
    });
  }
  const held: { id: string; until: Date }[] = [];
  for (const id of approved) {
    const r = await executeDm(deps, id);
    if (r.status === 'held') held.push({ id, until: r.until });
  }
  return { resumed: approved, unknown: executing, held };
}

/** Sends the approved DMs that something was holding, in the order they were decided. Anything still over a limit stays approved and is reported. */
export async function releaseDms(deps: ExecutorDeps): Promise<{ released: string[]; held: { id: string; until: Date }[] }> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string }>("select id from approvals where kind = 'dm.send' and status = 'approved' order by decided_at, id"));
  const released: string[] = [];
  const held: { id: string; until: Date }[] = [];
  for (const { id } of ids.rows) {
    const r = await executeDm(deps, id);
    if (r.status === 'executed') released.push(id);
    else if (r.status === 'held') held.push({ id, until: r.until });
  }
  return { released, held };
}
