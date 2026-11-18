import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { checkClaims, companyMarkdown, isSuppressed } from '../actions/policy';
import { briefOn, dayOf, latestBrief, rebuildBrief } from '../brief/build';
import { companyTimezone } from '../config';
import { checkFigures } from '../documents/figures';
import { ingestLead } from '../leads/ingest';
import { checkHook } from '../hooks';
import { checkBrief, estimateCredits, type Shot } from '../video/briefs';
import { normalizeUrl } from '../signals';
import { branchFacts, PrError, refHead, runTests } from '../projects/pr';
import { createHash } from 'node:crypto';
import { recallMemories, rememberMemory } from '../memory/memory';
import { addDraft, addPerson } from '../network/network';
import { addMeetingNote } from '../meetings/notes';
import { digits } from '../calls/desk';
import { runEval } from '../research/improvements';
import { rosterRoom, tryAutoTrial } from '../talent/hiring';
import { applySkillPatch, checkNewSkill, diffLines, locateSkill, readSkill, skillVersion } from '../memory/skills';
import { PROJECT_KEY } from '../projects/projects';
import { labelUntrusted } from './trust';
import { checkEvidence } from '../boardroom/evidence';
import { checkDm, dmEligible, dmSuppressed, isDmChannel, normalizeHandle } from '../dms';
import { checkPost, hashText, isPostPlatform } from '../posts';
import { addSignal, cleanExcerpt, looksLikeInstructions } from '../signals';
import { ToolError, type ImprovementInput, type AddHookInput, type AddLeadInput, type AddSignalInput, type BriefView, type DealView, type DraftKind, type LeadView, type OsStore, type ProposedEmail, type TaskView } from './os-tools';
import type { RunScope } from './run-tokens';

/** The `os` tools on the real database. Every write is scoped to the run's own workspace and task. */
export class DbOsStore implements OsStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly onChange: (workspaceId: string, taskId: string) => void = () => undefined,
    /** Where COMPANY.md lives, for the blocked-claims check on proposals: one folder, or a way to find the folder of the company a run belongs to (S6-13e). */
    private readonly companyRoot?: string | ((workspaceId: string) => string | undefined),
    private readonly onApproval: (workspaceId: string, approvalId: string) => void = () => undefined,
    /** Something moved in the office (a handoff): the office should look again (S6-13d2). */
    private readonly onOffice: (workspaceId: string) => void = () => undefined,
    /** The templates folder, to find the skills an agent has (S8-3). */
    private readonly templatesRoot?: string,
  ) {}

  /** The text of the COMPANY.md of the company this run belongs to, or nothing if its folder is not known. */
  private async companyText(workspaceId: string): Promise<string> {
    const root = typeof this.companyRoot === 'function' ? this.companyRoot(workspaceId) : this.companyRoot;
    return root ? companyMarkdown(root) : '';
  }

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

  async addSignal(scope: RunScope, input: AddSignalInput): Promise<{ id: string; created: boolean; flagged: boolean }> {
    return withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const excerpt = input.excerpt === undefined ? undefined : cleanExcerpt(input.excerpt);
      const flagged = !!excerpt && looksLikeInstructions(excerpt);
      const found = await addSignal(c, scope.workspaceId, { ...input, excerpt }, await this.actor(c, scope));
      // An item that reads like orders to an agent is kept as text, with a note for the person who reviews it. It changes nothing.
      if (found.created && flagged) await c.query('update signals set reason = $2 where id = $1', [found.id, 'The text of this item looked like instructions to an AI agent. It was kept as plain text only.']);
      return { ...found, flagged: found.created && flagged };
    });
  }

  async scoreSignal(scope: RunScope, input: { signalId: string; score: number; reason: string }): Promise<{ qualified: boolean }> {
    return withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const cur = (await c.query<{ status: string }>('select status from signals where id = $1 for update', [input.signalId])).rows[0];
      if (!cur) throw new ToolError('No such signal.');
      if (cur.status === 'promoted') throw new ToolError('That signal was already promoted to a lead by a person. Leave it alone.');
      if (cur.status === 'dismissed') throw new ToolError('A person dismissed that signal. Leave it alone.');
      const qualified = input.score >= 60;
      await c.query(
        "update signals set score = $2, reason = $3, status = case when $4 then 'qualified' else status end, updated_at = now() where id = $1",
        [input.signalId, input.score, input.reason, qualified],
      );
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'signal.scored', $3, $4)", [scope.workspaceId, await this.actor(c, scope), input.signalId, JSON.stringify({ score: input.score, qualified })]);
      return { qualified };
    });
  }

  async getDeal(scope: RunScope, dealId: string): Promise<DealView | null> {
    return withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const r = await c.query<{ id: string; account: string; offer: string | null; stage: string; status: string; decision_maker: string | null; due: Date | null; metric: string | null; value: string | null; baseline_value: string | null; target_value: string | null; outcome_value: string | null }>(
        `select d.id, a.name as account, d.offer, d.stage, d.status, d.decision_maker, d.due, d.metric, d.value, d.baseline_value, d.target_value, d.outcome_value
           from deals d join accounts a on a.id = d.account_id where d.id = $1`,
        [dealId],
      );
      const d = r.rows[0];
      if (!d) return null;
      const num = (v: string | null) => (v === null ? null : Number(v));
      const v = { value: num(d.value), baselineValue: num(d.baseline_value), targetValue: num(d.target_value), outcomeValue: num(d.outcome_value) };
      return {
        dealId: d.id,
        account: d.account,
        offer: d.offer,
        stage: d.stage,
        status: d.status,
        decisionMaker: d.decision_maker,
        due: d.due ? d.due.toISOString().slice(0, 10) : null,
        metric: d.metric,
        ...v,
        figures: Object.values(v).filter((x): x is number => x !== null),
      };
    });
  }

  async saveDraft(scope: RunScope, d: { dealId: string; kind: DraftKind; text: string }): Promise<void> {
    const deal = await this.getDeal(scope, d.dealId);
    if (!deal) throw new ToolError('No such deal.');
    // What each kind of document needs on record before it can be written honestly.
    if ((d.kind === 'outcome-note' || d.kind === 'proof-report') && deal.outcomeValue === null) {
      throw new ToolError('This deal has no recorded outcome yet, so an outcome note or a proof report cannot be written. Block the task and say the outcome number is missing.');
    }
    if (d.kind === 'contract-of-success' && (deal.baselineValue === null || deal.targetValue === null || !deal.metric)) {
      throw new ToolError('A contract of success needs the metric, the baseline and the target recorded on the deal. Block the task and say which is missing.');
    }
    const check = checkFigures(d.text, new Set(deal.figures));
    if (!check.ok) {
      throw new ToolError(`These figures are not in the tables for this deal: ${check.unknown.join(', ')}. A draft may state only figures from get_deal (${deal.figures.join(', ') || 'none recorded'}). Remove them or say the number is not known yet.`);
    }
    await this.comment(scope, `[Draft: ${d.kind}. For review; nothing has been sent.]\n${d.text}`);
    await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'draft.saved', $3, $4)", [scope.workspaceId, await this.actor(c, scope), d.dealId, JSON.stringify({ kind: d.kind })]);
    });
  }

  async getBrief(scope: RunScope): Promise<BriefView | null> {
    return withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const b = await latestBrief(c);
      return b ? { day: b.day, quiet: b.quiet, summary: b.summary, narrative: b.narrative, content: b.content } : null;
    });
  }

  async addBriefNote(scope: RunScope, text: string): Promise<{ day: string }> {
    return withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const now = new Date();
      const day = dayOf(now, companyTimezone());
      if (!(await briefOn(c, day))) await rebuildBrief(c, scope.workspaceId, now); // the note goes on a brief that exists
      await c.query('update briefs set narrative = $2, narrative_by = $3, updated_at = now() where day = $1', [day, text, await this.actor(c, scope)]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'brief.note', $3, '{}')", [scope.workspaceId, await this.actor(c, scope), day]);
      return { day };
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
    const companyMd = await this.companyText(scope.workspaceId);
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

  /**
   * The pull-request proposal (S7-5, SPEC 6). The server finds the task's worktree, refuses uncommitted work and an empty branch, and runs the
   * project's test command itself with a clean environment. A proposal the tests do not back is refused; nothing is pushed.
   */
  async proposePr(scope: RunScope, p: { title: string; summary: string }): Promise<{ approvalId: string; existed: boolean }> {
    const companyMd = await this.companyText(scope.workspaceId);
    const claims = checkClaims(`${p.title}
${p.summary}`, companyMd);
    if (!claims.ok) throw new ToolError(`Refused: ${claims.reasons.join('; ')}. Rewrite without it and propose again.`);
    if (!scope.taskId) throw new ToolError('A pull request belongs to a task.');
    const wt = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) =>
      (
        await c.query<{ path: string; branch: string; base_branch: string; key: string; test_cmd: string | null }>(
          "select w.path, w.branch, w.base_branch, p.key, p.test_cmd from code_worktrees w join code_projects p on p.id = w.project_id and p.workspace_id = w.workspace_id where w.task_id = $1 and w.status = 'open'",
          [scope.taskId],
        )
      ).rows[0],
    );
    if (!wt) throw new ToolError('This task has no worktree, so there is nothing to propose.');
    if (!wt.test_cmd) throw new ToolError(`The project "${wt.key}" has no test command, so a change to it cannot be proposed. Block the task and say so.`);
    let facts;
    try {
      facts = await branchFacts(wt.path, wt.base_branch);
    } catch (err) {
      if (err instanceof PrError) throw new ToolError(err.message);
      throw err;
    }
    const dedupe = `pr:${scope.taskId}:${facts.head}`;
    const found = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => (await c.query<{ id: string }>("select id from approvals where kind = 'pr.open' and dedupe_key = $1", [dedupe])).rows[0]);
    if (found) return { approvalId: found.id, existed: true };
    const tests = await runTests(wt.path, wt.test_cmd);
    if (!tests.ok) throw new ToolError(`The tests failed${tests.timedOut ? ' (they timed out)' : ''}, so nothing was proposed. Fix them and propose again.
${tests.output}`);
    const payload = { taskId: scope.taskId, projectKey: wt.key, branch: wt.branch, base: wt.base_branch, title: p.title, summary: p.summary, head: facts.head, commits: facts.commits, diffStat: facts.diffStat, tests: { command: wt.test_cmd, ok: true, output: tests.output } };
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const ins = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'pr.open', $2, $3, $4, $5, $6) on conflict (workspace_id, kind, dedupe_key) do nothing returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId, JSON.stringify(payload)],
      );
      if (ins.rows[0]) return { approvalId: ins.rows[0].id, existed: false };
      return { approvalId: (await c.query<{ id: string }>("select id from approvals where kind = 'pr.open' and dedupe_key = $1", [dedupe])).rows[0]!.id, existed: true };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  async addNetworkPerson(scope: RunScope, p: { name: string; whereFound: string; note: string }): Promise<{ created: boolean }> {
    try {
      return { created: (await addPerson(this.pool, scope.workspaceId, p)).created };
    } catch (err) {
      throw new ToolError((err as Error).message);
    }
  }

  async draftNetworkMessage(scope: RunScope, p: { personId: string; text: string }): Promise<void> {
    const claims = checkClaims(p.text, await this.companyText(scope.workspaceId));
    if (!claims.ok) throw new ToolError(`Refused: ${claims.reasons.join('; ')}. Rewrite without it and save again.`);
    try {
      await addDraft(this.pool, scope.workspaceId, p.personId, p.text);
    } catch (err) {
      throw new ToolError((err as Error).message);
    }
  }

  /** A reply to a client's channel message (S10-6): the message must exist, the text makes no blocked claim. Never sends. */
  async proposeChannelReply(scope: RunScope, p: { messageId: string; text: string }): Promise<{ approvalId: string; existed: boolean }> {
    const claims = checkClaims(p.text, await this.companyText(scope.workspaceId));
    if (!claims.ok) throw new ToolError(`Refused: ${claims.reasons.join('; ')}. Rewrite without it and propose again.`);
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const m = (await c.query<{ channel: string; from_name: string; status: string }>('select channel, from_name, status from channel_messages where id = $1', [p.messageId])).rows[0];
      if (!m) throw new ToolError('No such message.');
      const dedupe = `channel:${p.messageId}`;
      const payload = { messageId: p.messageId, channel: m.channel, to: m.from_name, text: p.text };
      const ins = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'channel.reply', $2, $3, $4, $5, $6) on conflict (workspace_id, kind, dedupe_key) do nothing returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      if (ins.rows[0]) return { approvalId: ins.rows[0].id, existed: false };
      return { approvalId: (await c.query<{ id: string }>("select id from approvals where kind = 'channel.reply' and dedupe_key = $1", [dedupe])).rows[0]!.id, existed: true };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  async addMeetingNote(scope: RunScope, n: { meetingId: string; text: string; actionItems?: string[] | undefined }): Promise<void> {
    try {
      await addMeetingNote(this.pool, scope.workspaceId, n.meetingId, { text: n.text, ...(n.actionItems ? { actionItems: n.actionItems } : {}) });
    } catch (err) {
      throw new ToolError((err as Error).message);
    }
  }

  /** A guest invite (S10-1): the meeting must be there and not over. Makes nothing: the link is made by the executor after approval. */
  async proposeMeeting(scope: RunScope, p: { meetingId: string; to: string; ttlHours?: number | undefined }): Promise<{ approvalId: string; existed: boolean }> {
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const m = (await c.query<{ title: string; status: string }>('select title, status from meetings where id = $1', [p.meetingId])).rows[0];
      if (!m) throw new ToolError('No such meeting.');
      if (m.status === 'cancelled' || m.status === 'closed') throw new ToolError(`That meeting is ${m.status}.`);
      const to = p.to.trim().toLowerCase();
      const dedupe = `meeting:${p.meetingId}:${to}`;
      const payload = { meetingId: p.meetingId, title: m.title, to, ttlHours: p.ttlHours ?? 48 };
      const ins = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'meeting.invite', $2, $3, $4, $5, $6) on conflict (workspace_id, kind, dedupe_key) do nothing returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      if (ins.rows[0]) return { approvalId: ins.rows[0].id, existed: false };
      return { approvalId: (await c.query<{ id: string }>("select id from approvals where kind = 'meeting.invite' and dedupe_key = $1", [dedupe])).rows[0]!.id, existed: true };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  /**
   * One call to one lead (S9-8). Every rule is checked here, in code: the lead exists and has a phone number, is not marked do not contact,
   * the number is not on the suppression list, and the opener and script make no blocked claim. It never calls.
   */
  async proposeCall(scope: RunScope, p: { leadId: string; opener: string; script: string }): Promise<{ approvalId: string; existed: boolean }> {
    const claims = checkClaims(`${p.opener}
${p.script}`, await this.companyText(scope.workspaceId));
    if (!claims.ok) throw new ToolError(`Refused: ${claims.reasons.join('; ')}. Rewrite without it and propose again.`);
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const l = (await c.query<{ phone: string | null; stage: string; business_name: string | null }>('select phone, stage, business_name from leads where id = $1', [p.leadId])).rows[0];
      if (!l) throw new ToolError('No such lead.');
      if (!l.phone) throw new ToolError('This lead has no phone number. Block the task and say so.');
      if (l.stage === 'do_not_contact') throw new ToolError('This lead is marked do not contact.');
      const supp = (await c.query<{ value: string }>('select value from suppression')).rows.map((r) => digits(r.value));
      if (supp.includes(digits(l.phone))) throw new ToolError('This number is on the suppression list. Do not call it.');
      const dedupe = `call:${p.leadId}`;
      const payload = { leadId: p.leadId, businessName: l.business_name, phone: l.phone, opener: p.opener, script: p.script };
      const ins = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'call.place', $2, $3, $4, $5, $6) on conflict (workspace_id, kind, dedupe_key) do nothing returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      if (ins.rows[0]) return { approvalId: ins.rows[0].id, existed: false };
      return { approvalId: (await c.query<{ id: string }>("select id from approvals where kind = 'call.place' and dedupe_key = $1", [dedupe])).rows[0]!.id, existed: true };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  /**
   * An improvement from the Research room (S8-11): the same card as a skill patch, with the evidence, the expected gain and the eval result.
   * The server runs the eval first. A proposal whose eval fails is recorded as such and never becomes a card, so it cannot be approved.
   */
  async proposeImprovement(scope: RunScope, p: ImprovementInput): Promise<{ approvalId: string; existed: boolean }> {
    if (!this.templatesRoot) throw new ToolError('This server cannot change skills.');
    const home = await locateSkill(this.templatesRoot, p.template, p.skill).catch(() => null);
    if (!home) throw new ToolError(`"${p.skill}" is not a skill of the template "${p.template}".`);
    const before = await readSkill(home.file);
    const bad = checkNewSkill(p.skill, before, p.text);
    if (bad) throw new ToolError(bad);
    const after = applySkillPatch(before, p.text);
    const cases = p.evalCases.map((c) => ({ ...(c.name ? { name: c.name } : {}), mustContain: c.mustContain, ...(c.mustNotContain ? { mustNotContain: c.mustNotContain } : {}) }));
    const ev = runEval(after, cases);
    const record = (status: 'proposed' | 'eval_failed', approvalId: string | null) =>
      withWorkspace(this.pool, scope.workspaceId, ({ client: c }) =>
        c.query('insert into improvements (workspace_id, approval_id, skill, why, expected_gain, evidence, status, eval_output) values ($1, $2, $3, $4, $5, $6, $7, $8)', [scope.workspaceId, approvalId, p.skill, p.why, p.expectedGain, JSON.stringify(p.evidence), status, ev.failures.join('\n')]),
      );
    if (!ev.ok) {
      await record('eval_failed', null);
      throw new ToolError(`The eval failed, so nothing was proposed: ${ev.failures.join('; ')}. Fix the text or the eval and propose again.`);
    }
    const payload = { improvement: 'true', skill: p.skill, owner: home.owner, why: p.why, expectedGain: p.expectedGain, evidence: p.evidence, evalCases: cases, eval: ev, fromVersion: skillVersion(before), toVersion: skillVersion(after), before, after, diff: diffLines(before, after) };
    const dedupe = `improve:${p.skill}:${createHash('sha256').update(after).digest('hex').slice(0, 16)}`;
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const ins = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'skill.patch', $2, $3, $4, $5, $6) on conflict (workspace_id, kind, dedupe_key) do nothing returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      if (ins.rows[0]) return { approvalId: ins.rows[0].id, existed: false };
      return { approvalId: (await c.query<{ id: string }>("select id from approvals where kind = 'skill.patch' and dedupe_key = $1", [dedupe])).rows[0]!.id, existed: true };
    });
    if (!out.existed) {
      await record('proposed', out.approvalId);
      this.onApproval(scope.workspaceId, out.approvalId);
    }
    return out;
  }

  /** A change to one of the agent's own skills (S8-3). Off until self-writing is on; the skill must be one it has; nothing is written. */
  async proposeSkillPatch(scope: RunScope, p: { skill: string; text: string; why: string }): Promise<{ approvalId: string; existed: boolean }> {
    if (!this.templatesRoot) throw new ToolError('This server cannot change skills.');
    const agent = (
      await withWorkspace(this.pool, scope.workspaceId, ({ client: c }) =>
        c.query<{ self_writing: boolean; template: string | null }>('select a.self_writing, t.key as template from agents a left join agent_templates t on t.id = a.template_id and t.workspace_id = a.workspace_id where a.id = $1', [scope.agentId]),
      )
    ).rows[0];
    if (!agent?.self_writing) throw new ToolError('Self-writing is off for you, so you cannot propose changes to your skills. Say what you would change in your final note instead.');
    if (!agent.template) throw new ToolError('You have no template, so no skills of your own.');
    const home = await locateSkill(this.templatesRoot, agent.template, p.skill);
    if (!home) throw new ToolError(`"${p.skill}" is not one of your skills.`);
    const before = await readSkill(home.file);
    const bad = checkNewSkill(p.skill, before, p.text);
    if (bad) throw new ToolError(bad);
    const after = applySkillPatch(before, p.text);
    const payload = { skill: p.skill, owner: home.owner, why: p.why, fromVersion: skillVersion(before), toVersion: skillVersion(after), before, after, diff: diffLines(before, after) };
    const dedupe = `skill:${p.skill}:${createHash('sha256').update(after).digest('hex').slice(0, 16)}`;
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const ins = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'skill.patch', $2, $3, $4, $5, $6) on conflict (workspace_id, kind, dedupe_key) do nothing returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      if (ins.rows[0]) return { approvalId: ins.rows[0].id, existed: false };
      return { approvalId: (await c.query<{ id: string }>("select id from approvals where kind = 'skill.patch' and dedupe_key = $1", [dedupe])).rows[0]!.id, existed: true };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  /** The winner of a scored bake-off as a hire card (S8-5), with every candidate's scores. Never hires. */
  async proposeHire(scope: RunScope, p: { bakeoff: string }): Promise<{ approvalId: string; existed: boolean; auto?: boolean }> {
    const room = await rosterRoom(this.pool, scope.workspaceId);
    if (!room.ok) throw new ToolError(`The roster is full (${room.active} of ${room.cap} active agents). Bench someone or raise the cap before proposing a hire.`);
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const b = (await c.query<{ department: string; template: string; trial_task: string; candidates: { roleId: string; source: string; key: string; name: string; boundaryAttempts: number; rating: number; costUsd: number }[] }>('select department, template, trial_task, candidates from bakeoffs where id = $1', [p.bakeoff])).rows[0];
      if (!b) throw new ToolError('There is no such bake-off.');
      const w = b.candidates[0];
      if (!w) throw new ToolError('That bake-off has no candidates.');
      if (w.boundaryAttempts > 0) throw new ToolError('Every candidate tried to cross a boundary, so none can be proposed.');
      const dedupe = `hire:${p.bakeoff}`;
      const payload = {
        bakeoffId: p.bakeoff,
        department: b.department,
        template: b.template,
        trialTask: b.trial_task,
        winner: { roleId: w.roleId, source: w.source, key: w.key, name: w.name },
        scores: b.candidates.map((x) => ({ source: x.source, key: x.key, name: x.name, boundaryAttempts: x.boundaryAttempts, rating: x.rating, costUsd: x.costUsd })),
        budgetUsd: 3,
      };
      const ins = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'hire', $2, $3, $4, $5, $6) on conflict (workspace_id, kind, dedupe_key) do nothing returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      if (ins.rows[0]) {
        await c.query("update bakeoffs set status = 'proposed' where id = $1", [p.bakeoff]);
        return { approvalId: ins.rows[0].id, existed: false };
      }
      return { approvalId: (await c.query<{ id: string }>("select id from approvals where kind = 'hire' and dedupe_key = $1", [dedupe])).rows[0]!.id, existed: true };
    });
    if (out.existed) return out;
    const auto = await tryAutoTrial(this.pool, scope.workspaceId, out.approvalId, this.templatesRoot);
    if (!auto.auto) this.onApproval(scope.workspaceId, out.approvalId);
    return { ...out, auto: auto.auto };
  }

  async remember(scope: RunScope, m: { text: string; scope: 'company' | 'market' }): Promise<void> {
    await rememberMemory(this.pool, scope.workspaceId, { scope: m.scope, text: m.text, source: `run:${scope.runId}`, agentId: scope.agentId });
  }

  async recall(scope: RunScope, query: string): Promise<{ scope: string; source: string; text: string }[]> {
    const rows = await recallMemories(this.pool, scope.workspaceId, { query, agentId: scope.agentId });
    return rows.map((r) => ({ scope: r.scope, source: r.source, text: r.text }));
  }

  /** A deploy of a project's default branch (S7-8). Refused for an unknown project or one with nothing committed. Never builds or serves. */
  async proposeDeploy(scope: RunScope, p: { project: string; client?: string | undefined }): Promise<{ approvalId: string; existed: boolean }> {
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const proj = (await c.query<{ path: string; default_branch: string; build_cmd: string | null }>('select path, default_branch, build_cmd from code_projects where key = $1', [p.project])).rows[0];
      if (!proj) throw new ToolError(`There is no project called "${p.project}".`);
      const head = await refHead(proj.path, proj.default_branch);
      if (!head) throw new ToolError(`"${p.project}" has no commits on ${proj.default_branch}: nothing has been pushed to its remote, so there is nothing to deploy.`);
      const dedupe = `deploy:${p.project}:${head}`;
      const payload = { projectKey: p.project, client: p.client ?? null, base: proj.default_branch, head, buildCmd: proj.build_cmd };
      const ins = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'deploy', $2, $3, $4, $5, $6) on conflict (workspace_id, kind, dedupe_key) do nothing returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      if (ins.rows[0]) return { approvalId: ins.rows[0].id, existed: false };
      return { approvalId: (await c.query<{ id: string }>("select id from approvals where kind = 'deploy' and dedupe_key = $1", [dedupe])).rows[0]!.id, existed: true };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  /** A new repository for a client (S7-7). Refused for a bad key or one that exists. Never creates it. */
  async proposeRepo(scope: RunScope, p: { key: string; description: string }): Promise<{ approvalId: string; existed: boolean }> {
    if (!PROJECT_KEY.test(p.key)) throw new ToolError('The key must be lower-case letters, digits and dashes, up to 40 characters.');
    const claims = checkClaims(p.description, await this.companyText(scope.workspaceId));
    if (!claims.ok) throw new ToolError(`Refused: ${claims.reasons.join('; ')}. Rewrite without it and propose again.`);
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      if ((await c.query('select 1 from code_projects where key = $1', [p.key])).rows[0]) throw new ToolError(`A project called "${p.key}" already exists.`);
      const dedupe = `repo:${p.key}`;
      const ins = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'repo.create', $2, $3, $4, $5, $6) on conflict (workspace_id, kind, dedupe_key) do nothing returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify({ key: p.key, description: p.description })],
      );
      if (ins.rows[0]) return { approvalId: ins.rows[0].id, existed: false };
      return { approvalId: (await c.query<{ id: string }>("select id from approvals where kind = 'repo.create' and dedupe_key = $1", [dedupe])).rows[0]!.id, existed: true };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  /** Merging an open pull request whose tests passed (S7-7). The tests are those the server ran when it was proposed. Never merges. */
  async proposeMerge(scope: RunScope, p: { project: string; number: number }): Promise<{ approvalId: string; existed: boolean }> {
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const r = (
        await c.query<{ status: string; title: string; branch: string; base: string; head: string; payload: { tests?: unknown; diffStat?: string } }>(
          'select r.status, r.title, r.branch, r.base, r.head, a.payload from code_pull_requests r join approvals a on a.id = r.approval_id and a.workspace_id = r.workspace_id where r.project_key = $1 and r.number = $2',
          [p.project, p.number],
        )
      ).rows[0];
      if (!r) throw new ToolError(`There is no pull request #${p.number} on "${p.project}".`);
      if (r.status !== 'open') throw new ToolError(`That pull request is ${r.status}, not open.`);
      const tests = r.payload.tests as { ok?: boolean } | undefined;
      if (!tests || tests.ok !== true) throw new ToolError('The tests have not passed for that pull request, so it cannot be merged.');
      const dedupe = `merge:${p.project}:${p.number}`;
      const payload = { projectKey: p.project, number: p.number, title: r.title, branch: r.branch, base: r.base, head: r.head, tests, diffStat: r.payload.diffStat ?? '' };
      const ins = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'pr.merge', $2, $3, $4, $5, $6) on conflict (workspace_id, kind, dedupe_key) do nothing returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      if (ins.rows[0]) return { approvalId: ins.rows[0].id, existed: false };
      return { approvalId: (await c.query<{ id: string }>("select id from approvals where kind = 'pr.merge' and dedupe_key = $1", [dedupe])).rows[0]!.id, existed: true };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  async proposeVideoBrief(scope: RunScope, b: { ideaId: string; title: string; script: string; shots: Shot[] }): Promise<{ approvalId: string; existed: boolean; credits: number }> {
    const companyMd = await this.companyText(scope.workspaceId);
    const check = checkBrief(b, companyMd);
    if (!check.ok) throw new ToolError(`Refused: ${check.reasons.join('; ')}. Rewrite without it and propose again.`);
    const credits = estimateCredits(b.shots);
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const idea = (await c.query<{ stage: string }>('select stage from video_ideas where id = $1', [b.ideaId])).rows[0];
      if (!idea) throw new ToolError('No such idea.');
      if (idea.stage !== 'brief') throw new ToolError(`This idea has not been turned into a brief by the founder (it is ${idea.stage}). Do not write a brief for it.`);
      const live = (await c.query<{ approval_id: string | null; estimated_credits: number }>("select approval_id, estimated_credits from video_briefs where idea_id = $1 and status not in ('rejected','expired','cancelled','failed')", [b.ideaId])).rows[0];
      if (live) throw new ToolError('This idea already has a brief waiting or in progress. Do not propose another.');
      const n = Number((await c.query<{ n: number }>('select count(*)::int as n from video_briefs where idea_id = $1', [b.ideaId])).rows[0]!.n);
      const payload = { title: b.title, estimatedCredits: credits, shots: b.shots.length, seconds: b.shots.reduce((s, x) => s + x.seconds, 0) };
      const ap = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'video.brief', $2, $3, $4, $5, $6) returning id",
        [scope.workspaceId, `video-brief:${b.ideaId}${n ? `:${n}` : ''}`, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify({ ...payload, briefId: null })],
      );
      const actor = await this.actor(c, scope);
      const brief = await c.query<{ id: string }>(
        'insert into video_briefs (workspace_id, idea_id, title, script, shots, estimated_credits, approval_id, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
        [scope.workspaceId, b.ideaId, b.title, b.script, JSON.stringify(b.shots), credits, ap.rows[0]!.id, actor],
      );
      await c.query('update approvals set payload = jsonb_set(payload, $2, to_jsonb($3::text)) where id = $1', [ap.rows[0]!.id, '{briefId}', brief.rows[0]!.id]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'video_brief.proposed', $3, $4)", [scope.workspaceId, actor, brief.rows[0]!.id, JSON.stringify({ credits, shots: b.shots.length })]);
      return { approvalId: ap.rows[0]!.id, existed: false, credits };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  async addHook(scope: RunScope, input: AddHookInput): Promise<{ id: string; created: boolean }> {
    const check = checkHook(input);
    if (!check.ok) throw new ToolError(`Refused: ${check.reasons.join('; ')}.`);
    const url = normalizeUrl(input.exampleUrl);
    return withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const actor = await this.actor(c, scope);
      const r = await c.query<{ id: string }>(
        'insert into hooks (workspace_id, pattern, format, platform, example_url, notes, found_by) values ($1, $2, $3, $4, $5, $6, $7) on conflict (workspace_id, example_url) do nothing returning id',
        [scope.workspaceId, input.pattern, input.format ?? null, input.platform ?? null, url, input.notes ?? null, actor],
      );
      if (!r.rows[0]) return { id: (await c.query<{ id: string }>('select id from hooks where example_url = $1', [url])).rows[0]!.id, created: false };
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'hook.filed', $3, $4)", [scope.workspaceId, actor, r.rows[0].id, JSON.stringify({ platform: input.platform ?? null })]);
      return { id: r.rows[0].id, created: true };
    });
  }

  async getPosts(scope: RunScope, o: { status?: string | undefined; limit: number }) {
    const r = await withWorkspace(this.pool, scope.workspaceId, ({ client: c }) =>
      c.query<{ id: string; platform: string; status: string; text: string; published_url: string | null; error: string | null; created_at: Date }>(
        'select id, platform, status, text, published_url, error, created_at from posts where ($1::text is null or status = $1) order by created_at desc, id limit $2',
        [o.status ?? null, o.limit],
      ),
    );
    return r.rows.map((p) => ({ id: p.id, platform: p.platform, status: p.status, text: p.text, url: p.published_url, error: p.error, at: p.created_at.toISOString() }));
  }

  async proposeDm(scope: RunScope, p: { accountId: string; leadId: string; recipient: string; text: string }): Promise<{ approvalId: string; existed: boolean }> {
    const text = p.text.trim();
    const recipient = normalizeHandle(p.recipient);
    const companyMd = await this.companyText(scope.workspaceId);
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const acct = (await c.query<{ id: string; channel: string; handle: string; health: string }>('select id, channel, handle, health from channel_accounts where id = $1', [p.accountId])).rows[0];
      if (!acct) throw new ToolError('No such account.');
      if (!isDmChannel(acct.channel)) throw new ToolError(`${acct.handle} is not a direct-message account (it is for ${acct.channel}).`);
      if (acct.health !== 'ok') throw new ToolError(`The account ${acct.handle} is ${acct.health}, so nothing can be proposed for it.`);
      const lead = (await c.query<{ stage: string; email: string | null }>('select stage, email from leads where id = $1', [p.leadId])).rows[0];
      if (!lead) throw new ToolError('No such lead.');
      if (lead.stage === 'do_not_contact') throw new ToolError('This lead is marked do not contact.');
      if (!dmEligible(lead.stage)) throw new ToolError('This lead has not been in touch with us, and we have not written to them first (a person approves that first message). A direct message to them would be a cold message, which is not allowed. Email first.');
      const supp = await c.query<{ value: string }>('select value from suppression');
      if (dmSuppressed(recipient, lead.email, supp.rows.map((r) => r.value))) throw new ToolError('This person is on the suppression list. Do not contact them.');
      const check = checkDm(acct.channel, text, companyMd);
      if (!check.ok) throw new ToolError(`Refused: ${check.reasons.join('; ')}. Rewrite without it and propose again.`);
      const hash = hashText(text);
      const prior = await c.query<{ status: string; approval_id: string | null }>('select status, approval_id from dms where channel_account_id = $1 and recipient = $2 and text_hash = $3 order by created_at desc', [acct.id, recipient, hash]);
      const live = prior.rows.find((r) => !['rejected', 'expired', 'cancelled'].includes(r.status));
      if (live?.approval_id) return { approvalId: live.approval_id, existed: true };
      const dedupe = `dm:${acct.id}:${recipient}:${hash}${prior.rows.length ? `:${prior.rows.length}` : ''}`;
      const payload = { channel: acct.channel, handle: acct.handle, accountId: acct.id, leadId: p.leadId, recipient: `@${recipient}`, text };
      const ap = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'dm.send', $2, $3, $4, $5, $6) returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      const actor = await this.actor(c, scope);
      const dm = await c.query<{ id: string }>(
        'insert into dms (workspace_id, channel_account_id, channel, lead_id, recipient, text, text_hash, approval_id, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id',
        [scope.workspaceId, acct.id, acct.channel, p.leadId, recipient, text, hash, ap.rows[0]!.id, actor],
      );
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'dm.proposed', $3, $4)", [scope.workspaceId, actor, dm.rows[0]!.id, JSON.stringify({ channel: acct.channel, approval: ap.rows[0]!.id })]);
      return { approvalId: ap.rows[0]!.id, existed: false };
    });
    if (!out.existed) this.onApproval(scope.workspaceId, out.approvalId);
    return out;
  }

  async proposePost(scope: RunScope, p: { accountId: string; text: string; briefId?: string | undefined }): Promise<{ approvalId: string; existed: boolean }> {
    const text = p.text.trim();
    const companyMd = await this.companyText(scope.workspaceId);
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const acct = (await c.query<{ id: string; channel: string; handle: string; health: string }>('select id, channel, handle, health from channel_accounts where id = $1', [p.accountId])).rows[0];
      if (!acct) throw new ToolError('No such account.');
      if (!isPostPlatform(acct.channel)) throw new ToolError(`${acct.handle} is not a posting account (it is for ${acct.channel}).`);
      if (acct.health !== 'ok') throw new ToolError(`The account ${acct.handle} is ${acct.health}, so nothing can be proposed for it.`);
      // The rules are code, not a prompt: length, blocked claims, prices, and links to domains the company file does not approve.
      const check = checkPost(acct.channel, text, companyMd);
      if (!check.ok) throw new ToolError(`Refused: ${check.reasons.join('; ')}. Rewrite without it and propose again.`);
      // A video goes only when its plan has passed review, and what is approved names the exact plan (its hash).
      let planHash: string | null = null;
      if (p.briefId) {
        const vb = (await c.query<{ status: string; plan_hash: string | null; review: { ok?: boolean } | null }>('select status, plan_hash, review from video_briefs where id = $1', [p.briefId])).rows[0];
        if (!vb) throw new ToolError('No such video.');
        if (vb.status !== 'ready' || !vb.review?.ok || !vb.plan_hash) throw new ToolError(`That video is not ready: its plan has not passed review (it is ${vb.status}). Do not post it.`);
        planHash = vb.plan_hash;
      }
      const hash = hashText(p.briefId ? `${text}\n[video ${p.briefId}]` : text);
      const prior = await c.query<{ status: string; approval_id: string | null }>('select status, approval_id from posts where channel_account_id = $1 and text_hash = $2 order by created_at desc', [acct.id, hash]);
      const live = prior.rows.find((r) => !['rejected', 'expired', 'cancelled'].includes(r.status));
      if (live?.approval_id) return { approvalId: live.approval_id, existed: true };
      // A dead earlier proposal of the same words (rejected, say) does not block a new one; it gets its own approval key.
      const dedupe = `post:${acct.id}:${hash}${prior.rows.length ? `:${prior.rows.length}` : ''}`;
      const payload = { platform: acct.channel, handle: acct.handle, accountId: acct.id, text, ...(p.briefId ? { briefId: p.briefId, planHash } : {}) };
      const ap = await c.query<{ id: string }>(
        "insert into approvals (workspace_id, kind, dedupe_key, agent_id, run_id, task_id, payload) values ($1, 'post.publish', $2, $3, $4, $5, $6) returning id",
        [scope.workspaceId, dedupe, scope.agentId, scope.runId, scope.taskId ?? null, JSON.stringify(payload)],
      );
      const actor = await this.actor(c, scope);
      const post = await c.query<{ id: string }>(
        'insert into posts (workspace_id, channel_account_id, platform, text, text_hash, approval_id, created_by, video_brief_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
        [scope.workspaceId, acct.id, acct.channel, text, hash, ap.rows[0]!.id, actor, p.briefId ?? null],
      );
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'post.proposed', $3, $4)", [scope.workspaceId, actor, post.rows[0]!.id, JSON.stringify({ platform: acct.channel, approval: ap.rows[0]!.id })]);
      return { approvalId: ap.rows[0]!.id, existed: false };
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
      const m = await c.query<{ from_id: string; body: string; created_at: Date; low: boolean }>(
        "select m.from_id, m.body, m.created_at, exists (select 1 from agents a where 'agent:' || a.key = m.from_id and a.trust = 'low') as low from messages m where m.task_id = $1 order by m.created_at",
        [scope.taskId],
      );
      // What a low-trust agent wrote reaches a reader as data, in a label, never as plain text that could pass for an instruction (A1).
      return { ...t.rows[0], comments: m.rows.map((r) => ({ from: r.from_id, body: r.low ? labelUntrusted(r.from_id.replace(/^agent:/, ''), r.body) : r.body, at: r.created_at.toISOString() })) };
    });
  }

  async openDiscussion(scope: RunScope, d: { kind: 'standup' | 'weekly' | 'adhoc'; question: string; participants: string[] }): Promise<string> {
    const id = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const me = (await c.query<{ key: string }>('select key from agents where id = $1', [scope.agentId])).rows[0];
      for (const k of d.participants) if (!(await c.query("select 1 from agents where key = $1 and status = 'active'", [k])).rows[0]) throw new ToolError(`There is no active agent "${k}" to include. Use an agent's key.`);
      const r = await c.query<{ id: string }>('insert into discussions (workspace_id, kind, question, opened_by, participants) values ($1, $2, $3, $4, $5::jsonb) returning id', [scope.workspaceId, d.kind, d.question, `agent:${me?.key ?? scope.agentId}`, JSON.stringify(d.participants)]);
      return r.rows[0]!.id;
    });
    this.onOffice(scope.workspaceId);
    return id;
  }

  async addTurn(scope: RunScope, t: { discussionId: string; round: number; body: string; evidence: unknown[]; summary: boolean; disagreements?: string | undefined }) {
    await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const me = (await c.query<{ key: string }>('select key from agents where id = $1', [scope.agentId])).rows[0];
      const speaker = me?.key ?? scope.agentId;
      const d = (await c.query<{ status: string; participants: string[] }>('select status, participants from discussions where id = $1 for update', [t.discussionId])).rows[0];
      if (!d) throw new ToolError('There is no such discussion.');
      if (d.status !== 'open') throw new ToolError('That discussion is closed.');
      if (d.participants.length && !d.participants.includes(speaker)) throw new ToolError('You are not one of the agents this discussion is for.');
      if ((await c.query('select 1 from discussion_turns where discussion_id = $1 and speaker = $2 and round = $3', [t.discussionId, speaker, t.round])).rows[0]) throw new ToolError(`You have already taken your turn in round ${t.round}.`);
      if (t.summary && !t.disagreements) throw new ToolError('A summary must say where the leads disagree. Write "None." if they do not.');
      // The rule that makes the Boardroom useful, in code: no evidence, or evidence the tables do not bear out, and the turn is not kept.
      if (t.evidence.length === 0) throw new ToolError('A turn must cite evidence: a count or a record the OS can check against its tables.');
      const checked = await checkEvidence(c, t.evidence);
      if (!checked.ok) throw new ToolError(`Refused: ${checked.reasons.join('; ')}. Cite what the tables show and add your turn again.`);
      await c.query('insert into discussion_turns (workspace_id, discussion_id, speaker, round, body, evidence, disagreements) values ($1, $2, $3, $4, $5, $6::jsonb, $7)', [scope.workspaceId, t.discussionId, speaker, t.round, t.body, JSON.stringify(t.evidence), t.disagreements ?? null]);
    });
    this.onOffice(scope.workspaceId);
  }

  async getDecisions(scope: RunScope): Promise<string> {
    const rows = await withWorkspace(this.pool, scope.workspaceId, ({ client: c }) =>
      c.query<{ title: string; decision: string; owner: string | null; due: string | null; decided_at: Date }>("select title, decision, owner, to_char(due, 'YYYY-MM-DD') as due, decided_at from decisions order by decided_at desc, id desc limit 20"),
    );
    if (!rows.rows.length) return 'No decisions have been recorded yet.';
    return rows.rows.map((r) => `- ${new Date(r.decided_at).toISOString().slice(0, 10)} ${r.title}: ${r.decision}${r.owner ? ` (owner: ${r.owner}${r.due ? `, by ${r.due}` : ''})` : ''}`).join('\n');
  }

  async departmentSay(scope: RunScope, text: string) {
    await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const a = (await c.query<{ key: string; department_id: string | null }>('select key, department_id from agents where id = $1', [scope.agentId])).rows[0];
      if (!a?.department_id) throw new ToolError('You are not in a department, so there is no channel to post to.');
      await c.query('insert into department_messages (workspace_id, department_id, author, body) values ($1, $2, $3, $4)', [scope.workspaceId, a.department_id, `agent:${a.key}`, text]);
    });
  }

  async handOffTask(scope: RunScope, to: string, note: string) {
    await this.inTask(scope, async (c, taskId, key) => {
      const me = (await c.query<{ department_id: string | null }>('select department_id from agents where id = $1', [scope.agentId])).rows[0];
      if (to === key) throw new ToolError('That is you. Name a colleague.');
      const them = (await c.query<{ id: string }>("select id from agents where key = $1 and status = 'active' and department_id is not distinct from $2 and department_id is not null", [to, me?.department_id ?? null])).rows[0];
      if (!them) throw new ToolError(`There is no active colleague "${to}" in your department.`);
      // The task is theirs now: back to todo, with nobody holding it, and the earlier session left behind (it was this agent's).
      await c.query("update tasks set assignee_id = $2, status = 'todo', locked_by = null, session_id = null, blocked_reason = null where id = $1", [taskId, them.id]);
      await c.query('insert into messages (workspace_id, task_id, from_id, to_id, body) values ($1, $2, $3, $4, $5)', [scope.workspaceId, taskId, `agent:${key}`, `agent:${to}`, note]);
    });
    this.onOffice(scope.workspaceId);
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
