import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { checkClaims, companyMarkdown, isSuppressed } from '../actions/policy';
import { ingestLead } from '../leads/ingest';
import { ToolError, type AddLeadInput, type LeadView, type OsStore, type ProposedEmail, type TaskView } from './os-tools';
import type { RunScope } from './run-tokens';

/** The `os` tools on the real database. Every write is scoped to the run's own workspace and task. */
export class DbOsStore implements OsStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly onChange: (workspaceId: string, taskId: string) => void = () => undefined,
    /** Where COMPANY.md lives, for the blocked-claims check on proposals. */
    private readonly companyRoot?: string,
    private readonly onApproval: (workspaceId: string, approvalId: string) => void = () => undefined,
  ) {}

  async autonomy(scope: RunScope): Promise<number> {
    const r = await withWorkspace(this.pool, scope.workspaceId, ({ client: c }) =>
      c.query<{ autonomy: number; status: string }>('select autonomy, status from agents where id = $1', [scope.agentId]),
    );
    const a = r.rows[0];
    return a && a.status === 'active' ? a.autonomy : 0;
  }

  /** The key of the calling agent, for the audit log. */
  private async actor(c: pg.PoolClient, scope: RunScope): Promise<string> {
    const r = await c.query<{ key: string }>('select key from agents where id = $1', [scope.agentId]);
    return `agent:${r.rows[0]?.key ?? scope.agentId}`;
  }

  async addLead(scope: RunScope, input: AddLeadInput): Promise<{ id: string; existed: boolean; by?: 'email' | 'website'; verified: boolean }> {
    return withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      // Verified means there is a source. Nothing else makes a lead verified, whatever the agent says in its notes.
      const verified = !!input.sourceUrl;
      const r = await ingestLead(c, scope.workspaceId, input, verified);
      if (r.kind === 'suppressed') throw new ToolError('That address is on the suppression list, so it was not added. Do not look for another way to reach it.');
      if (r.kind === 'duplicate') return { id: r.id, existed: true, by: r.by, verified: true };
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'lead.added', $3, $4)", [
        scope.workspaceId,
        await this.actor(c, scope),
        r.id,
        JSON.stringify({ verified, sourceUrl: input.sourceUrl ?? null }),
      ]);
      return { id: r.id, existed: false, verified };
    });
  }

  async scoreLead(scope: RunScope, input: { leadId: string; score: number; reason: string }): Promise<void> {
    await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const r = await c.query('update leads set score = $2, score_reason = $3, scored_at = now() where id = $1 returning id', [input.leadId, input.score, input.reason]);
      if (!r.rows[0]) throw new ToolError('No such lead.');
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'lead.scored', $3, $4)", [
        scope.workspaceId,
        await this.actor(c, scope),
        input.leadId,
        JSON.stringify({ score: input.score }),
      ]);
    });
  }

  async getLead(scope: RunScope, leadId: string): Promise<LeadView | null> {
    const r = await withWorkspace(this.pool, scope.workspaceId, ({ client: c }) =>
      c.query<LeadView>(
        'select id, business_name as "businessName", website, contact_name as "contactName", email, stage, notes from leads where id = $1',
        [leadId],
      ),
    );
    return r.rows[0] ?? null;
  }

  /**
   * The proposal handler (SPEC 6). Every rule that must always hold is checked here, in code:
   * the lead exists in this workspace, has an address, is not suppressed or marked do-not-contact,
   * and the text makes no blocked claim (CLAUDE.md rules 1, 7). It never sends.
   */
  async proposeEmail(scope: RunScope, p: ProposedEmail): Promise<{ approvalId: string; existed: boolean }> {
    const companyMd = this.companyRoot ? await companyMarkdown(this.companyRoot) : '';
    const claims = checkClaims(`${p.subject}\n${p.body}`, companyMd);
    if (!claims.ok) throw new ToolError(`Refused: ${claims.reasons.join('; ')}. Rewrite without it and propose again.`);
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const lead = await c.query<{ email: string | null; stage: string }>('select email, stage from leads where id = $1', [p.leadId]);
      const l = lead.rows[0];
      if (!l) throw new ToolError('No such lead.');
      if (!l.email) throw new ToolError('This lead has no email address. Block the task and say so.');
      if (l.stage === 'do_not_contact') throw new ToolError('This lead is marked do not contact.');
      const supp = await c.query<{ value: string }>('select value from suppression');
      if (isSuppressed(l.email, supp.rows.map((r) => r.value))) throw new ToolError('This address is on the suppression list. Do not contact it.');
      // An email can belong to a campaign, but only one that is running: draft, approved-but-not-started, paused and
      // finished campaigns propose nothing. The executor checks again at send time.
      let campaign: { id: string; channel_account_id: string | null } | undefined;
      if (p.campaignId) {
        const cp = await c.query<{ id: string; name: string; status: string; channel: string; channel_account_id: string | null }>('select id, name, status, channel, channel_account_id from campaigns where id = $1', [p.campaignId]);
        campaign = cp.rows[0];
        if (!campaign) throw new ToolError('No such campaign.');
        const row = cp.rows[0]!;
        if (row.status !== 'running') throw new ToolError(`The campaign "${row.name}" is ${row.status}, not running, so nothing can be proposed for it.`);
        if (row.channel !== 'email') throw new ToolError(`The campaign "${row.name}" is for ${row.channel}, not email.`);
      }
      const payload = { leadId: p.leadId, to: l.email, subject: p.subject, body: p.body, step: p.step, ...(p.campaignId ? { campaignId: p.campaignId } : {}) };
      const ins = await c.query<{ id: string }>(
        `insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload)
         values ($1, 'email.send', $2, $3, $4, $5, $6)
         on conflict (workspace_id, kind, dedupe_key) do nothing returning id`,
        [scope.workspaceId, `email:${p.leadId}:${p.step}`, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      if (!ins.rows[0]) {
        const existing = await c.query<{ id: string }>("select id from approvals where kind = 'email.send' and dedupe_key = $1", [`email:${p.leadId}:${p.step}`]);
        return { approvalId: existing.rows[0]!.id, existed: true };
      }
      await c.query(
        "insert into outreach_messages (workspace_id, lead_id, channel, step, to_address, subject, body, approval_id, status, campaign_id, channel_account_id) values ($1, $2, 'email', $3, $4, $5, $6, $7, 'queued', $8, $9)",
        [scope.workspaceId, p.leadId, p.step, l.email, p.subject, p.body, ins.rows[0].id, p.campaignId ?? null, campaign?.channel_account_id ?? null],
      );
      return { approvalId: ins.rows[0].id, existed: false };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  private async inTask<T>(scope: RunScope, fn: (c: pg.PoolClient, taskId: string, agentKey: string) => Promise<T>): Promise<T> {
    if (!scope.taskId) throw new ToolError('This run has no task.');
    const taskId = scope.taskId;
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      // The row is locked until this transaction ends, so a person moving the task back to todo (PATCH) waits
      // for this call to finish instead of slipping in between the check and the write.
      const t = await c.query<{ status: string; locked_by: string | null; key: string }>(
        'select t.status, t.locked_by, a.key from tasks t join agents a on a.id = $2 where t.id = $1 for update of t',
        [taskId, scope.agentId],
      );
      const row = t.rows[0];
      if (!row) throw new ToolError('This run has no task.');
      // A run may act on a task only while it holds it: the run loop checked it out, so it is in progress and
      // locked by this agent. A task a person has since moved, finished or cancelled is no longer this run's.
      if (row.status !== 'in_progress') throw new ToolError(`The task is not in progress (it is ${row.status}), so this run cannot change it.`);
      if (row.locked_by !== scope.agentId) throw new ToolError('The task is not held by this agent (it is held by another agent, or by nobody).');
      return fn(c, taskId, row.key);
    });
    this.onChange(scope.workspaceId, taskId);
    return out;
  }

  async getTask(scope: RunScope): Promise<TaskView | null> {
    if (!scope.taskId) return null;
    return withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const t = await c.query<{ id: string; title: string; body: string | null; status: string }>(
        'select id, title, body, status from tasks where id = $1',
        [scope.taskId],
      );
      if (!t.rows[0]) return null;
      const m = await c.query<{ from_id: string; body: string; created_at: Date }>(
        'select from_id, body, created_at from messages where task_id = $1 order by created_at',
        [scope.taskId],
      );
      return { ...t.rows[0], comments: m.rows.map((r) => ({ from: r.from_id, body: r.body, at: r.created_at.toISOString() })) };
    });
  }

  async comment(scope: RunScope, text: string) {
    await this.inTask(scope, (c, taskId, key) =>
      c.query('insert into messages (workspace_id, task_id, from_id, body) values ($1, $2, $3, $4)', [scope.workspaceId, taskId, `agent:${key}`, text]),
    );
  }

  async completeTask(scope: RunScope, output: string) {
    await this.inTask(scope, async (c, taskId, key) => {
      await c.query('insert into messages (workspace_id, task_id, from_id, body) values ($1, $2, $3, $4)', [scope.workspaceId, taskId, `agent:${key}`, output]);
      await c.query("update tasks set status = 'done', done_at = now(), locked_by = null where id = $1", [taskId]);
    });
  }

  async blockTask(scope: RunScope, reason: string) {
    await this.inTask(scope, (c, taskId) => c.query("update tasks set status = 'blocked', blocked_reason = $2, locked_by = null where id = $1", [taskId, reason]));
  }

  async askFounder(scope: RunScope, question: string) {
    await this.inTask(scope, async (c, taskId, key) => {
      await c.query("insert into messages (workspace_id, task_id, from_id, to_id, body) values ($1, $2, $3, 'founder', $4)", [scope.workspaceId, taskId, `agent:${key}`, question]);
      await c.query("update tasks set status = 'blocked', blocked_reason = $2, locked_by = null where id = $1", [taskId, `Waiting for the founder: ${question}`]);
      await c.query("insert into action_items (workspace_id, kind, title, body, task_id) values ($1, 'question', $2, $3, $4)", [scope.workspaceId, `A question from ${key}`, question, taskId]);
    });
  }
}
