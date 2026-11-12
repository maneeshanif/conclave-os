import type pg from 'pg';
import { z } from 'zod';
import type { Bus } from '../bus';
import { withWorkspace } from '../db/tenant';
import { checkClaims, companyMarkdown, emailFooter, isSuppressed } from './policy';
import type { EmailTransport } from './transport';

export const EmailPayload = z.object({
  leadId: z.uuid(),
  to: z.email(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  step: z.number().int().min(1).max(10).default(1),
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
  | { status: 'refused'; reason: string }
  | { status: 'failed'; reason: string };

async function killSwitchOn(c: pg.PoolClient): Promise<boolean> {
  const r = await c.query<{ kill_switch: number }>('select kill_switch from workspace_settings');
  return (r.rows[0]?.kill_switch ?? 0) === 1;
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

  // 1. Claim, unless the kill switch is on. Both in one transaction.
  const claimed = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if (await killSwitchOn(c)) return 'kill_switch' as const;
    const r = await c.query<{ payload: unknown; edited_payload: unknown }>(
      "update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'email.send' returning payload, edited_payload",
      [approvalId],
    );
    return r.rows[0] ?? null;
  });
  if (claimed === 'kill_switch') return { status: 'kill_switch' };
  if (!claimed) return { status: 'already_claimed' };

  const finish = async (status: 'executed' | 'failed', result: Record<string, unknown>, outreach: 'sent' | 'refused' | 'failed', item?: { kind: string; title: string; body: string }) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, status, JSON.stringify(result)]);
      await c.query(
        "update outreach_messages set status = $2, sent_at = case when $2 = 'sent' then now() else sent_at end, external_ref = $3 where approval_id = $1",
        [approvalId, outreach, (result.ref as string | undefined) ?? null],
      );
      if (item) {
        await c.query('insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, $2, $3, $4, $5)', [ws, item.kind, item.title, item.body, approvalId]);
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

  const state = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    const lead = await c.query<{ email: string | null; stage: string }>('select email, stage from leads where id = $1', [p.leadId]);
    const supp = await c.query<{ value: string }>('select value from suppression');
    const settings = await c.query<{ email_daily_cap: number }>('select email_daily_cap from workspace_settings');
    const today = new Date(now());
    today.setHours(0, 0, 0, 0);
    const sent = await c.query<{ n: number }>("select count(*)::int as n from outreach_messages where channel = 'email' and status = 'sent' and sent_at >= $1", [today]);
    return { lead: lead.rows[0], suppressed: supp.rows.map((r) => r.value), cap: settings.rows[0]?.email_daily_cap ?? 20, sentToday: sent.rows[0]?.n ?? 0 };
  });

  // Executors send only to recipients already in your tables (SPEC 15, prompt injection).
  if (!state.lead) return refuse('the lead no longer exists');
  if (!state.lead.email || state.lead.email.toLowerCase() !== p.to.toLowerCase()) return refuse('the address does not match the lead on record');
  if (state.lead.stage === 'do_not_contact') return refuse('the lead is marked do not contact');
  if (isSuppressed(p.to, state.suppressed)) return refuse('the address is on the suppression list');
  if (state.sentToday >= state.cap) return refuse(`today's email cap of ${state.cap} is reached; approve it again tomorrow`);
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
export async function recoverApprovals(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
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
      await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'send_unknown', 'An email may or may not have been sent', 'The server stopped while this email was being sent. It was not resent. Check the provider before approving a new copy.', $2)", [ws, id]);
    });
  }
  for (const id of approved) await executeEmail(deps, id);
  return { resumed: approved, unknown: executing };
}
