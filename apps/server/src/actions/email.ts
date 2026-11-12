import type pg from 'pg';
import { z } from 'zod';
import type { Bus } from '../bus';
import { withWorkspace } from '../db/tenant';
import { readSettings, startOfToday, startOfTomorrow, type Settings } from '../settings';
import { checkClaims, companyMarkdown, emailFooter, isSuppressed } from './policy';
import type { EmailTransport } from './transport';

export const EmailPayload = z.object({
  leadId: z.uuid(),
  to: z.email(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  step: z.number().int().min(1).max(10).default(1),
  /** The campaign this email belongs to, when it belongs to one. Its mailbox's caps then apply. */
  campaignId: z.uuid().optional(),
});
export type EmailPayload = z.infer<typeof EmailPayload>;

export interface ExecutorDeps {
  pool: pg.Pool;
  workspaceId: string;
  transport: EmailTransport;
  companyRoot: string;
  from: string;
  bus?: Bus;
  now?: () => Date;
}

export type ExecResult =
  | { status: 'executed'; ref: string }
  | { status: 'already_claimed' }
  | { status: 'kill_switch' }
  /** Over a send cap. Not claimed and not failed: still approved, and it goes when there is room (`until`). */
  | { status: 'held'; reason: string; until: Date }
  | { status: 'refused'; reason: string }
  | { status: 'failed'; reason: string };

type Held = Extract<ExecResult, { status: 'held' }>;

/**
 * Is there room to send one more? Two caps, both settings: a rolling window (follow-ups count like first
 * emails) and a per-day cap. Emails mid-send count too, so a burst cannot all see room that only one can use.
 * Returns the hold, with when it opens, or null if there is room. Runs inside the claim's transaction, under the
 * workspace send lock.
 */
export async function capHold(c: pg.PoolClient, s: Settings, now: Date): Promise<Held | null> {
  const windowMs = s.windowHours * 3_600_000;
  // Everything is counted in ONE statement, so it is one snapshot. Counting "sent" and "in flight" in two statements
  // lets an email that finishes between them be missed by both (no longer in flight, not yet sent), and the cap is
  // overshot by one. This was caught by a burst test that sent 4 against a cap of 3.
  const counts = await c.query<{ sent: Date[]; today: number; in_flight: number }>(
    `select array(select sent_at from outreach_messages
                    where channel = 'email' and status = 'sent' and sent_at >= $1 order by sent_at) as sent,
            (select count(*)::int from outreach_messages
              where channel = 'email' and status = 'sent' and sent_at >= $2) as today,
            (select count(*)::int from approvals where kind = 'email.send' and status = 'executing') as in_flight`,
    [new Date(now.getTime() - windowMs), startOfToday(now)],
  );
  const { sent, today, in_flight: inFlight } = counts.rows[0]!;

  let hold: Held | null = null;
  const used = sent.length + inFlight;
  if (used >= s.windowCap) {
    // The send that must leave the window for there to be room is the (used - cap + 1)th oldest. If it is one
    // that is still mid-send there is no time to give yet, so look again soon.
    const idx = used - s.windowCap;
    const until = idx < sent.length ? new Date(sent[idx]!.getTime() + windowMs) : new Date(now.getTime() + 60_000);
    hold = { status: 'held', reason: `the limit of ${s.windowCap} emails in ${s.windowHours} hours is reached`, until };
  }
  if (today + inFlight >= s.emailDailyCap) {
    const until = startOfTomorrow(now);
    if (!hold || until > hold.until) hold = { status: 'held', reason: `today's limit of ${s.emailDailyCap} emails is reached`, until };
  }
  return hold;
}

/**
 * What the campaign and its mailbox say about sending one more email now (S2-3): a reason to refuse it (the campaign
 * is not running, the mailbox is paused or blocked), or a hold (the mailbox's cap for today, which is the smaller
 * warm-up cap while the mailbox warms up). Counts what went out today through that mailbox plus what is mid-send.
 * Runs inside the claim's transaction, under the workspace send lock.
 */
async function channelCheck(c: pg.PoolClient, campaignId: string | undefined, now: Date): Promise<{ refusal?: string; hold?: Held }> {
  if (!campaignId) return {};
  const r = await c.query<{ name: string; status: string; channel_account_id: string | null; handle: string | null; health: string | null; daily_cap: number | null; warmup_until: Date | null; warmup_cap: number | null }>(
    `select cp.name, cp.status, cp.channel_account_id, ca.handle, ca.health, ca.daily_cap, ca.warmup_until, ca.warmup_cap
       from campaigns cp left join channel_accounts ca on ca.id = cp.channel_account_id where cp.id = $1`,
    [campaignId],
  );
  const cp = r.rows[0];
  if (!cp) return { refusal: 'the campaign this email belongs to no longer exists' };
  if (cp.status !== 'running') return { refusal: `the campaign "${cp.name}" is ${cp.status}, not running` };
  if (!cp.channel_account_id || cp.health === null) return { refusal: `the campaign "${cp.name}" has no mailbox` };
  if (cp.health !== 'ok') return { refusal: `the mailbox ${cp.handle} is ${cp.health}` };
  const warming = cp.warmup_until !== null && cp.warmup_until >= startOfToday(now);
  const cap = warming ? Math.min(cp.warmup_cap!, cp.daily_cap!) : cp.daily_cap!;
  const used = await c.query<{ n: number }>(
    `select (select count(*)::int from outreach_messages where channel_account_id = $1 and status = 'sent' and sent_at >= $2)
          + (select count(*)::int from approvals a join campaigns k on k.id::text = a.payload ->> 'campaignId'
              where a.kind = 'email.send' and a.status = 'executing' and k.channel_account_id = $1) as n`,
    [cp.channel_account_id, startOfToday(now)],
  );
  if (used.rows[0]!.n >= cap) {
    return { hold: { status: 'held', reason: `${cp.handle}'s daily limit of ${cap} emails is reached${warming ? ' (it is still warming up)' : ''}`, until: startOfTomorrow(now) } };
  }
  return {};
}

/**
 * The email executor (SPEC 6). Plain code, no model. It claims the approval once, moving it from
 * `approved` to `executing`; a second call finds nothing to claim and returns without sending.
 * Every pre-send check runs again here, because the world can change between proposal and approval.
 * A send is never retried: a failure after the claim is recorded and raised to a person.
 */
export async function executeEmail(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const now = deps.now ?? (() => new Date());

  // 1. Claim, unless the kill switch is on or a cap is reached. All in one transaction.
  let refusal: string | undefined;
  const outcome = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    const settings = await readSettings(c, ws);
    if (settings.killSwitch) return { kind: 'kill_switch' as const };
    // Only an approval that is approved is ours to send, and a cap is no reason to touch one that is not.
    const mine = await c.query<{ payload: { campaignId?: string } }>("select id, payload from approvals where id = $1 and status = 'approved' and kind = 'email.send' for update", [approvalId]);
    if (!mine.rows[0]) return { kind: 'none' as const };
    // One lock per workspace around "count what has gone out, then claim", so parallel sends cannot overshoot.
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`email-send:${ws}`]);
    // An email of a campaign that is no longer running, or from a mailbox that is not healthy, is claimed and refused
    // below with the reason, rather than held for ever. Otherwise the mailbox's own cap applies as well as the workspace's.
    const channel = await channelCheck(c, mine.rows[0].payload?.campaignId, now());
    if (!channel.refusal) {
      const hold = await capHold(c, settings, now());
      const own = channel.hold;
      const later = hold && own ? (own.until > hold.until ? own : hold) : (hold ?? own);
      if (later) return { kind: 'held' as const, hold: later };
    }
    refusal = channel.refusal;
    const r = await c.query<{ payload: unknown; edited_payload: unknown }>(
      "update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'email.send' returning payload, edited_payload",
      [approvalId],
    );
    return r.rows[0] ? { kind: 'claimed' as const, row: r.rows[0] } : { kind: 'none' as const };
  });
  if (outcome.kind === 'kill_switch') return { status: 'kill_switch' };
  if (outcome.kind === 'held') return outcome.hold;
  if (outcome.kind === 'none') return { status: 'already_claimed' };
  const claimed = outcome.row;

  const finish = async (status: 'executed' | 'failed', result: Record<string, unknown>, outreach: 'sent' | 'refused' | 'failed', item?: { kind: string; title: string; body: string }) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, status, JSON.stringify(result)]);
      await c.query(
        "update outreach_messages set status = $2, sent_at = case when $2 = 'sent' then now() else sent_at end, external_ref = $3 where approval_id = $1",
        [approvalId, outreach, (result.ref as string | undefined) ?? null],
      );
      if (item) {
        await c.query('insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, $2, $3, $4, $5) on conflict do nothing', [ws, item.kind, item.title, item.body, approvalId]);
      }
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:email', $2, $3, $4)", [
        ws,
        `approval.${status}`,
        approvalId,
        JSON.stringify(result),
      ]);
    });
    deps.bus?.publish({ kind: 'task.changed', workspaceId: ws, taskId: approvalId });
  };

  // 2. Checks that must hold at send time.
  const parsed = EmailPayload.safeParse(claimed.edited_payload ?? claimed.payload);
  if (!parsed.success) {
    const reason = `bad payload: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
    await finish('failed', { reason }, 'refused');
    return { status: 'refused', reason };
  }
  const p = parsed.data;
  const refuse = async (reason: string): Promise<ExecResult> => {
    await finish('failed', { reason }, 'refused', { kind: 'executor_failed', title: `Email to ${p.to} not sent`, body: reason });
    return { status: 'refused', reason };
  };

  if (refusal) return refuse(refusal);

  // Nothing can be sent without a sender address, and none is invented: the person sets OUTREACH_FROM.
  if (!deps.from.trim()) return refuse('OUTREACH_FROM is not set, so there is no sender address. Set it in .env (see .env.example), then approve a new copy.');

  const state = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    const lead = await c.query<{ email: string | null; stage: string }>('select email, stage from leads where id = $1', [p.leadId]);
    const supp = await c.query<{ value: string }>('select value from suppression');
    return { lead: lead.rows[0], suppressed: supp.rows.map((r) => r.value) };
  });

  // Executors send only to recipients already in your tables (SPEC 15, prompt injection).
  if (!state.lead) return refuse('the lead no longer exists');
  if (!state.lead.email || state.lead.email.toLowerCase() !== p.to.toLowerCase()) return refuse('the address does not match the lead on record');
  if (state.lead.stage === 'do_not_contact') return refuse('the lead is marked do not contact');
  if (isSuppressed(p.to, state.suppressed)) return refuse('the address is on the suppression list');
  const claims = checkClaims(`${p.subject}\n${p.body}`, await companyMarkdown(deps.companyRoot));
  if (!claims.ok) return refuse(`blocked claims: ${claims.reasons.join('; ')}`);
  const footer = await emailFooter(deps.companyRoot);
  if (footer.placeholder) return refuse('the cold email footer in COMPANY.md still has a placeholder address; fill it in first');

  // 3. Send once. No retry.
  try {
    const { ref } = await deps.transport.send({
      id: approvalId,
      from: deps.from,
      to: p.to,
      subject: p.subject,
      text: `${p.body}\n\n--\n${footer.text}`,
      headers: { 'List-Unsubscribe': `<mailto:${deps.from.replace(/^.*<|>$/g, '')}?subject=unsubscribe>`, 'X-Conclave-Approval': approvalId },
    });
    await finish('executed', { ref, transport: deps.transport.name }, 'sent');
    await withWorkspace(deps.pool, ws, ({ client: c }) => c.query("update leads set stage = 'contacted' where id = $1 and stage = 'new'", [p.leadId]));
    return { status: 'executed', ref };
  } catch (err) {
    const reason = (err as Error).message;
    await finish('failed', { reason, transport: deps.transport.name }, 'failed', {
      kind: 'send_unknown',
      title: `Email to ${p.to} failed while sending`,
      body: `${reason}\nIt was not retried. Check the provider's log before approving a new copy.`,
    });
    return { status: 'failed', reason };
  }
}

/**
 * Run on server start (SPEC 6: the approvals row is the source of truth). Approved emails that never
 * ran are executed now. An email left `executing` may or may not have gone out, so it is never
 * resent: it is marked failed and raised to a person.
 */
export async function recoverApprovals(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[]; held: { id: string; until: Date }[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    const a = await c.query<{ id: string }>("select id from approvals where kind = 'email.send' and status = 'approved' order by decided_at");
    const e = await c.query<{ id: string }>("select id from approvals where kind = 'email.send' and status = 'executing'");
    return { approved: a.rows.map((r) => r.id), executing: e.rows.map((r) => r.id) };
  });
  for (const id of executing) {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query("update approvals set status = 'failed', result = $2 where id = $1 and status = 'executing'", [id, JSON.stringify({ reason: 'interrupted while sending; outcome unknown' })]);
      await c.query("update outreach_messages set status = 'failed' where approval_id = $1", [id]);
      await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'send_unknown', 'An email may or may not have been sent', 'The server stopped while this email was being sent. It was not resent. Check the provider before approving a new copy.', $2) on conflict do nothing", [ws, id]);
    });
  }
  // In the order they were decided. One that is over a cap stays approved and is reported, so the gate can try again when there is room.
  const held: { id: string; until: Date }[] = [];
  for (const id of approved) {
    const r = await executeEmail(deps, id);
    if (r.status === 'held') held.push({ id, until: r.until });
  }
  return { resumed: approved, unknown: executing, held };
}

/**
 * Sends the approved emails that something was holding (the kill switch, a send cap), in the order they were
 * decided, on request. Unlike recovery it touches nothing that is mid-send, so it is safe to run while the server
 * is working. Anything still over a cap is reported and stays approved.
 */
export async function releaseApproved(deps: ExecutorDeps): Promise<{ released: string[]; held: { id: string; until: Date }[] }> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) =>
    c.query<{ id: string }>("select id from approvals where kind = 'email.send' and status = 'approved' order by decided_at, id"),
  );
  const released: string[] = [];
  const held: { id: string; until: Date }[] = [];
  for (const { id } of ids.rows) {
    const r = await executeEmail(deps, id);
    if (r.status === 'executed') released.push(id);
    else if (r.status === 'held') held.push({ id, until: r.until });
  }
  return { released, held };
}
