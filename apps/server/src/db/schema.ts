// The twelve slice 0 tables, as SPEC 11 gives them (tenancy rule included).
//
// Every foreign key between tenant tables is composite: (workspace_id, x_id) references t (workspace_id, id).
// Postgres runs foreign key checks without row-level security, so a plain key would let a row in
// workspace A point at a row in workspace B. Every constraint is named, because the generated names
// for composite keys run past Postgres's 63-character limit.
//
// Row-level security, roles and grants are not expressible here. They live in the hand-written
// migration `*_rls_roles_grants.sql` next to the generated one.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  type PgTableExtraConfigValue,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const workspaceId = () => uuid('workspace_id').notNull().references(() => workspaces.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  mode: text('mode').notNull().default('local'), // local | team
  createdAt: createdAt(),
});

export const members = pgTable(
  'members',
  {
    workspaceId: workspaceId(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ name: 'members_pkey', columns: [t.workspaceId, t.userId] }),
    check('members_role_check', sql`${t.role} in ('owner','admin','member','viewer')`),
  ],
);

export const departments = pgTable(
  'departments',
  {
    id: id(),
    workspaceId: workspaceId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    leadAgentId: uuid('lead_agent_id'),
    room: jsonb('room').notNull().default({}),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('departments_ws_key_uq').on(t.workspaceId, t.key),
    unique('departments_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'departments_lead_agent_fk',
      columns: [t.workspaceId, t.leadAgentId],
      foreignColumns: [agents.workspaceId, agents.id],
    }),
  ],
);

export const agentTemplates = pgTable(
  'agent_templates',
  {
    id: id(),
    workspaceId: workspaceId(),
    key: text('key').notNull(),
    version: integer('version').notNull().default(1),
    path: text('path').notNull(),
  },
  (t) => [
    unique('agent_templates_ws_key_uq').on(t.workspaceId, t.key),
    unique('agent_templates_ws_id_uq').on(t.workspaceId, t.id),
  ],
);

export const agents = pgTable(
  'agents',
  {
    id: id(),
    workspaceId: workspaceId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    departmentId: uuid('department_id').notNull(),
    reportsTo: uuid('reports_to'),
    templateId: uuid('template_id'),
    templateVersion: integer('template_version'),
    runtime: text('runtime').notNull(),
    modelAlias: text('model_alias').notNull(),
    fallbackAlias: text('fallback_alias'),
    fallbackRuntime: text('fallback_runtime'),
    // Whether the agent may propose changes to its own skills (S8-3). Off for a new agent until a person switches it on.
    selfWriting: boolean('self_writing').notNull().default(false),
    trust: text('trust').notNull().default('standard'), // standard | low (A1): low-trust agents are contained in the server
    heartbeatCron: text('heartbeat_cron'),
    // What the scheduled morning run asks the agent to do, from the role file. Empty: the agent is only woken (S2-8).
    heartbeatTask: text('heartbeat_task'),
    // The last scheduled time a heartbeat was handled (asked, skipped or let go). Kept in the database so a restart does not ask again.
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    autonomy: smallint('autonomy').notNull().default(0),
    maxTurns: integer('max_turns').notNull().default(25),
    outputCheck: text('output_check'),
    monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 10, scale: 2 }).notNull().default('5'),
    status: text('status').notNull().default('pending_approval'), // pending_approval | active | paused | retired
    rolePath: text('role_path').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('agents_ws_key_uq').on(t.workspaceId, t.key),
    unique('agents_ws_id_uq').on(t.workspaceId, t.id),
    check(
      'agents_runtime_check',
      sql`${t.runtime} in ('claude-cli','opencode','openai-agents','codex','http','claude-agent')`,
    ),
    foreignKey({
      name: 'agents_department_fk',
      columns: [t.workspaceId, t.departmentId],
      foreignColumns: [departments.workspaceId, departments.id],
    }),
    foreignKey({
      name: 'agents_reports_to_fk',
      columns: [t.workspaceId, t.reportsTo],
      foreignColumns: [t.workspaceId, t.id],
    }),
    foreignKey({
      name: 'agents_template_fk',
      columns: [t.workspaceId, t.templateId],
      foreignColumns: [agentTemplates.workspaceId, agentTemplates.id],
    }),
  ],
);

export const goals = pgTable(
  'goals',
  {
    id: id(),
    workspaceId: workspaceId(),
    key: text('key').notNull(),
    kind: text('kind').notNull(), // rung | department
    parentId: uuid('parent_id'),
    departmentId: uuid('department_id'),
    title: text('title'),
    metric: text('metric'),
    target: numeric('target'),
    source: text('source'),
    due: date('due'),
    status: text('status').notNull().default('active'),
  },
  (t) => [
    unique('goals_ws_key_uq').on(t.workspaceId, t.key),
    unique('goals_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'goals_parent_fk',
      columns: [t.workspaceId, t.parentId],
      foreignColumns: [t.workspaceId, t.id],
    }),
    foreignKey({
      name: 'goals_department_fk',
      columns: [t.workspaceId, t.departmentId],
      foreignColumns: [departments.workspaceId, departments.id],
    }),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    workspaceId: workspaceId(),
    goalId: uuid('goal_id'),
    parentId: uuid('parent_id'),
    departmentId: uuid('department_id'),
    assigneeId: uuid('assignee_id'),
    title: text('title').notNull(),
    body: text('body'),
    kind: text('kind').notNull().default('general'),
    status: text('status').notNull().default('todo'), // todo | in_progress | waiting_approval | blocked | done | cancelled
    priority: smallint('priority').notNull().default(3),
    blockedReason: text('blocked_reason'),
    lockedBy: uuid('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    sessionId: text('session_id'),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (t) => [
    unique('tasks_ws_id_uq').on(t.workspaceId, t.id),
    index('tasks_ws_assignee_status_idx').on(t.workspaceId, t.assigneeId, t.status, t.priority, t.createdAt),
    foreignKey({
      name: 'tasks_goal_fk',
      columns: [t.workspaceId, t.goalId],
      foreignColumns: [goals.workspaceId, goals.id],
    }),
    foreignKey({
      name: 'tasks_parent_fk',
      columns: [t.workspaceId, t.parentId],
      foreignColumns: [t.workspaceId, t.id],
    }),
    foreignKey({
      name: 'tasks_department_fk',
      columns: [t.workspaceId, t.departmentId],
      foreignColumns: [departments.workspaceId, departments.id],
    }),
    foreignKey({
      name: 'tasks_assignee_fk',
      columns: [t.workspaceId, t.assigneeId],
      foreignColumns: [agents.workspaceId, agents.id],
    }),
  ],
);

export const runs = pgTable(
  'runs',
  {
    id: id(),
    workspaceId: workspaceId(),
    agentId: uuid('agent_id').notNull(),
    taskId: uuid('task_id'),
    trigger: text('trigger').notNull(),
    runtime: text('runtime').notNull(),
    model: text('model'),
    sessionId: text('session_id'),
    status: text('status').notNull().default('queued'), // queued | running | waiting_approval | succeeded | failed | cancelled | timed_out
    attempt: smallint('attempt').notNull().default(1),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    tokensIn: integer('tokens_in').default(0),
    tokensOut: integer('tokens_out').default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).default('0'),
    error: text('error'),
  },
  (t) => [
    unique('runs_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'runs_agent_fk',
      columns: [t.workspaceId, t.agentId],
      foreignColumns: [agents.workspaceId, agents.id],
    }),
    foreignKey({
      name: 'runs_task_fk',
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
    }),
  ],
);

export const runEvents = pgTable(
  'run_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: workspaceId(),
    runId: uuid('run_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    type: text('type').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [
    unique('run_events_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'run_events_run_fk',
      columns: [t.workspaceId, t.runId],
      foreignColumns: [runs.workspaceId, runs.id],
    }),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    workspaceId: workspaceId(),
    kind: text('kind').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    agentId: uuid('agent_id'),
    runId: uuid('run_id'),
    taskId: uuid('task_id'),
    payload: jsonb('payload').notNull(),
    editedPayload: jsonb('edited_payload'),
    status: text('status').notNull().default('pending'), // pending | approved | executing | executed | rejected | expired | failed
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedDevice: text('decided_device'),
    decisionNote: text('decision_note'),
    result: jsonb('result'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('approvals_ws_kind_dedupe_uq').on(t.workspaceId, t.kind, t.dedupeKey),
    unique('approvals_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'approvals_agent_fk',
      columns: [t.workspaceId, t.agentId],
      foreignColumns: [agents.workspaceId, agents.id],
    }),
    foreignKey({
      name: 'approvals_run_fk',
      columns: [t.workspaceId, t.runId],
      foreignColumns: [runs.workspaceId, runs.id],
    }),
    foreignKey({
      name: 'approvals_task_fk',
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
    }),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    workspaceId: workspaceId(),
    taskId: uuid('task_id'),
    fromId: text('from_id').notNull(),
    toId: text('to_id'),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('messages_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'messages_task_fk',
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
    }),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: workspaceId(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    subject: text('subject'),
    data: jsonb('data').notNull().default({}),
  },
  (t) => [unique('audit_log_ws_id_uq').on(t.workspaceId, t.id)],
);

// ---------------------------------------------------------------------------------------------------
// Slice 1: approvals and outreach (SPEC 6, 10, 15). Same tenancy rule; RLS in *_slice1_rls.sql.

/** A person or business the company may contact. Slice 2 grows this into accounts, contacts and deals. */
export const leads = pgTable(
  'leads',
  {
    id: id(),
    workspaceId: workspaceId(),
    market: text('market').notNull().default('services'), // services | product | founder_network
    businessName: text('business_name'),
    website: text('website'),
    contactName: text('contact_name'),
    email: text('email'),
    stage: text('stage').notNull().default('new'), // new | contacted | replied | won | lost | do_not_contact
    ownerAgentId: uuid('owner_agent_id'),
    notes: text('notes'),
    accountId: uuid('account_id'), // set when the lead is promoted (S2-1)
    domain: text('domain'), // the website's host without www, for finding the same business twice (S2-7)
    sourceUrl: text('source_url'), // where the lead was found
    // True only with a source (or when a person says so). Unverified leads cannot join a campaign. Leads a person adds by hand are verified.
    verified: boolean('verified').notNull().default(true),
    score: smallint('score'), // 0 to 100, with the reason
    scoreReason: text('score_reason'),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('leads_ws_id_uq').on(t.workspaceId, t.id),
    index('leads_ws_domain_idx').on(t.workspaceId, t.domain),
    check('leads_score_ck', sql`${t.score} is null or ${t.score} between 0 and 100`),
    foreignKey({ name: 'leads_account_fk', columns: [t.workspaceId, t.accountId], foreignColumns: [accounts.workspaceId, accounts.id] }),
    // One lead per address, however it was typed. Many leads may have no address yet.
    uniqueIndex('leads_ws_email_uq')
      .on(t.workspaceId, sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    foreignKey({ name: 'leads_owner_fk', columns: [t.workspaceId, t.ownerAgentId], foreignColumns: [agents.workspaceId, agents.id] }),
  ],
);

/** A sales funnel, loaded from company/funnels.yaml (S2-2). */
export const funnels = pgTable(
  'funnels',
  {
    id: id(),
    workspaceId: workspaceId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    market: text('market'),
    createdAt: createdAt(),
  },
  (t) => [unique('funnels_ws_id_uq').on(t.workspaceId, t.id), unique('funnels_ws_key_uq').on(t.workspaceId, t.key)],
);

/** One stage of a funnel. `exit_requires` lists what a deal needs before it may move past; `won` marks the winning stage. */
export const funnelStages = pgTable(
  'funnel_stages',
  {
    id: id(),
    workspaceId: workspaceId(),
    funnelId: uuid('funnel_id').notNull(),
    key: text('key').notNull(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    owner: text('owner'),
    exitRule: text('exit_rule'),
    exitRequires: text('exit_requires').array().notNull().default(sql`'{}'::text[]`),
    won: boolean('won').notNull().default(false),
    retired: boolean('retired').notNull().default(false),
  },
  (t) => [
    unique('funnel_stages_ws_id_uq').on(t.workspaceId, t.id),
    unique('funnel_stages_funnel_key_uq').on(t.workspaceId, t.funnelId, t.key),
    foreignKey({ name: 'funnel_stages_funnel_fk', columns: [t.workspaceId, t.funnelId], foreignColumns: [funnels.workspaceId, funnels.id] }),
  ],
);

/** Every move of a deal between stages: the source of days-in-stage and conversion (S2-6). */
export const dealStageEvents = pgTable(
  'deal_stage_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: workspaceId(),
    dealId: uuid('deal_id').notNull(),
    fromStage: text('from_stage'),
    toStage: text('to_stage').notNull(),
    actor: text('actor').notNull(),
    note: text('note'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('deal_stage_events_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ name: 'deal_stage_events_deal_fk', columns: [t.workspaceId, t.dealId], foreignColumns: [deals.workspaceId, deals.id] }),
    index('deal_stage_events_deal_idx').on(t.workspaceId, t.dealId, t.at),
  ],
);

/** Delivery work for a won client (SPEC 10). One per won deal. */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    workspaceId: workspaceId(),
    accountId: uuid('account_id').notNull(),
    dealId: uuid('deal_id'),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'), // active | done | paused
    createdAt: createdAt(),
  },
  (t) => [
    unique('projects_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('projects_ws_deal_uq').on(t.workspaceId, t.dealId).where(sql`${t.dealId} is not null`),
    foreignKey({ name: 'projects_account_fk', columns: [t.workspaceId, t.accountId], foreignColumns: [accounts.workspaceId, accounts.id] }),
    foreignKey({ name: 'projects_deal_fk', columns: [t.workspaceId, t.dealId], foreignColumns: [deals.workspaceId, deals.id] }),
  ],
);

/** A business: a client or a prospect that has become more than a lead (SPEC 10). */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    website: text('website'),
    market: text('market'),
    stage: text('stage').notNull().default('prospect'), // prospect | client | past_client | lost
    ownerAgentId: uuid('owner_agent_id'),
    health: text('health'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('accounts_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ name: 'accounts_owner_fk', columns: [t.workspaceId, t.ownerAgentId], foreignColumns: [agents.workspaceId, agents.id] }),
    check('accounts_stage_ck', sql`${t.stage} in ('prospect','client','past_client','lost')`),
  ],
);

/** A person at an account, with every channel handle. */
export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    workspaceId: workspaceId(),
    accountId: uuid('account_id').notNull(),
    name: text('name'),
    role: text('role'),
    email: text('email'),
    phone: text('phone'),
    instagram: text('instagram'),
    xHandle: text('x_handle'),
    linkedin: text('linkedin'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('contacts_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ name: 'contacts_account_fk', columns: [t.workspaceId, t.accountId], foreignColumns: [accounts.workspaceId, accounts.id] }),
    index('contacts_account_idx').on(t.workspaceId, t.accountId),
  ],
);

/** An open opportunity: offer, value, stage, next step, due date. */
export const deals = pgTable(
  'deals',
  {
    id: id(),
    workspaceId: workspaceId(),
    accountId: uuid('account_id').notNull(),
    offer: text('offer'),
    value: numeric('value'),
    funnelId: uuid('funnel_id'),
    stage: text('stage').notNull().default('open'), // a stage key of its funnel
    status: text('status').notNull().default('open'), // open | won | lost
    decisionMaker: text('decision_maker'),
    // The one number the deal is about (S2-12): what is measured, where it started, the target, and where it ended up.
    // Documents may quote these and nothing else.
    metric: text('metric'),
    baselineValue: numeric('baseline_value'),
    targetValue: numeric('target_value'),
    outcomeValue: numeric('outcome_value'),
    lostReason: text('lost_reason'),
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }).notNull().defaultNow(),
    nextStep: text('next_step'),
    due: date('due'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('deals_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ name: 'deals_funnel_fk', columns: [t.workspaceId, t.funnelId], foreignColumns: [funnels.workspaceId, funnels.id] }),
    check('deals_status_ck', sql`${t.status} in ('open','won','lost')`),
    foreignKey({ name: 'deals_account_fk', columns: [t.workspaceId, t.accountId], foreignColumns: [accounts.workspaceId, accounts.id] }),
    check('deals_value_ck', sql`${t.value} is null or ${t.value} >= 0`),
    check('deals_figures_ck', sql`(${t.baselineValue} is null or ${t.baselineValue} >= 0) and (${t.targetValue} is null or ${t.targetValue} >= 0) and (${t.outcomeValue} is null or ${t.outcomeValue} >= 0)`),
    index('deals_account_idx').on(t.workspaceId, t.accountId),
  ],
);

/** A mailbox or social account the OS sends from. The caps live here, not in a prompt (SPEC 10, 15). */
export const channelAccounts = pgTable(
  'channel_accounts',
  {
    id: id(),
    workspaceId: workspaceId(),
    channel: text('channel').notNull(), // email | x_dm | ig_dm | linkedin
    handle: text('handle').notNull(),
    dailyCap: integer('daily_cap').notNull().default(10),
    warmupUntil: date('warmup_until'),
    warmupCap: integer('warmup_cap').notNull().default(5),
    health: text('health').notNull().default('ok'), // ok | paused | blocked
    // How a post goes out (S5-3): outbox (a file) or browser (a signed-in profile). Switched to browser on purpose, per account.
    transport: text('transport').notNull().default('outbox'),
    browserProfile: text('browser_profile'), // the profile folder name under DATA_DIR/browser-profiles; null until a person has logged in
    sessionState: text('session_state').notNull().default('none'), // none | valid | expired
    sessionCheckedAt: timestamp('session_checked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('channel_accounts_transport_ck', sql`${t.transport} in ('outbox','browser')`),
    check('channel_accounts_session_ck', sql`${t.sessionState} in ('none','valid','expired')`),
    unique('channel_accounts_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('channel_accounts_handle_uq').on(t.workspaceId, t.channel, sql`lower(${t.handle})`),
    check('channel_accounts_caps_ck', sql`${t.dailyCap} between 1 and 1000 and ${t.warmupCap} between 1 and 1000`),
    check('channel_accounts_health_ck', sql`${t.health} in ('ok','paused','blocked')`),
  ],
);

/** One push: a market, an audience, a channel, a sequence, a status. A founder approves it before it runs. */
export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    market: text('market'),
    channel: text('channel').notNull().default('email'),
    audience: jsonb('audience').notNull().default(sql`'{}'::jsonb`),
    channelAccountId: uuid('channel_account_id'),
    status: text('status').notNull().default('draft'), // draft | approved | running | paused | done
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('campaigns_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ name: 'campaigns_channel_fk', columns: [t.workspaceId, t.channelAccountId], foreignColumns: [channelAccounts.workspaceId, channelAccounts.id] }),
    check('campaigns_status_ck', sql`${t.status} in ('draft','approved','running','paused','done')`),
  ],
);

/** The ordered messages of a campaign, with the wait before each. Step 1 goes out at once. */
export const sequenceSteps = pgTable(
  'sequence_steps',
  {
    id: id(),
    workspaceId: workspaceId(),
    campaignId: uuid('campaign_id').notNull(),
    step: smallint('step').notNull(),
    waitDays: smallint('wait_days').notNull().default(0),
    skill: text('skill'),
    template: text('template'),
  },
  (t) => [
    unique('sequence_steps_ws_id_uq').on(t.workspaceId, t.id),
    unique('sequence_steps_campaign_step_uq').on(t.workspaceId, t.campaignId, t.step),
    foreignKey({ name: 'sequence_steps_campaign_fk', columns: [t.workspaceId, t.campaignId], foreignColumns: [campaigns.workspaceId, campaigns.id] }),
  ],
);

/** Who is in which campaign, and where they are in its sequence. A reply or an unsubscribe pauses it (S2-4). */
export const sequenceEnrollments = pgTable(
  'sequence_enrollments',
  {
    id: id(),
    workspaceId: workspaceId(),
    campaignId: uuid('campaign_id').notNull(),
    leadId: uuid('lead_id').notNull(),
    stepsSent: smallint('steps_sent').notNull().default(0),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    requestedStep: smallint('requested_step').notNull().default(0), // the step the runner last made a task for
    stepTaskId: uuid('step_task_id'),
    status: text('status').notNull().default('active'), // active | paused | done | unsubscribed
    pausedReason: text('paused_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sequence_enrollments_ws_id_uq').on(t.workspaceId, t.id),
    unique('sequence_enrollments_campaign_lead_uq').on(t.workspaceId, t.campaignId, t.leadId),
    foreignKey({ name: 'sequence_enrollments_campaign_fk', columns: [t.workspaceId, t.campaignId], foreignColumns: [campaigns.workspaceId, campaigns.id] }),
    foreignKey({ name: 'sequence_enrollments_task_fk', columns: [t.workspaceId, t.stepTaskId], foreignColumns: [tasks.workspaceId, tasks.id] }),
    foreignKey({ name: 'sequence_enrollments_lead_fk', columns: [t.workspaceId, t.leadId], foreignColumns: [leads.workspaceId, leads.id] }),
    check('sequence_enrollments_status_ck', sql`${t.status} in ('active','paused','done','unsubscribed')`),
    index('sequence_enrollments_lead_idx').on(t.workspaceId, t.leadId),
  ],
);

/** One thread per contact (or lead): every email, reply and note with them, in order (SPEC 10). */
export const threads = pgTable(
  'threads',
  {
    id: id(),
    workspaceId: workspaceId(),
    leadId: uuid('lead_id'),
    contactId: uuid('contact_id'),
    status: text('status').notNull().default('open'), // open | closed
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('threads_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('threads_ws_lead_uq').on(t.workspaceId, t.leadId).where(sql`${t.leadId} is not null`),
    foreignKey({ name: 'threads_lead_fk', columns: [t.workspaceId, t.leadId], foreignColumns: [leads.workspaceId, leads.id] }),
    foreignKey({ name: 'threads_contact_fk', columns: [t.workspaceId, t.contactId], foreignColumns: [contacts.workspaceId, contacts.id] }),
    check('threads_who_ck', sql`${t.leadId} is not null or ${t.contactId} is not null`),
  ],
);

/** A message in a thread. Inbound text is data from outside: stored and shown, never obeyed. */
export const threadMessages = pgTable(
  'thread_messages',
  {
    id: id(),
    workspaceId: workspaceId(),
    threadId: uuid('thread_id').notNull(),
    direction: text('direction').notNull(), // in | out
    channel: text('channel').notNull().default('email'),
    subject: text('subject'),
    body: text('body').notNull(),
    campaignId: uuid('campaign_id'),
    classification: text('classification'), // positive | neutral | negative
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('thread_messages_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ name: 'thread_messages_thread_fk', columns: [t.workspaceId, t.threadId], foreignColumns: [threads.workspaceId, threads.id] }),
    check('thread_messages_direction_ck', sql`${t.direction} in ('in','out')`),
    check('thread_messages_class_ck', sql`${t.classification} is null or ${t.classification} in ('positive','neutral','negative')`),
    index('thread_messages_thread_idx').on(t.workspaceId, t.threadId, t.at),
  ],
);

/** The morning brief: one record per day, built from the tables and kept as it was (S2-10). */
export const briefs = pgTable(
  'briefs',
  {
    id: id(),
    workspaceId: workspaceId(),
    day: date('day').notNull(),
    quiet: boolean('quiet').notNull().default(false),
    summary: jsonb('summary').notNull().default(sql`'[]'::jsonb`),
    content: jsonb('content').notNull(),
    // One paragraph written by the chief of staff agent. Shown as the agent's; the numbers never depend on it.
    narrative: text('narrative'),
    narrativeBy: text('narrative_by'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('briefs_ws_id_uq').on(t.workspaceId, t.id), unique('briefs_ws_day_uq').on(t.workspaceId, t.day)],
);

/** A runtime that has hit its plan limit: its agents start no runs until `until` (S3-3). One active pause per runtime. */
export const runtimePauses = pgTable(
  'runtime_pauses',
  {
    id: id(),
    workspaceId: workspaceId(),
    runtime: text('runtime').notNull(),
    until: timestamp('until', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
    liftedAt: timestamp('lifted_at', { withTimezone: true }),
    liftedBy: text('lifted_by'), // system at the reset, or the person who lifted it early
  },
  (t) => [
    unique('runtime_pauses_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('runtime_pauses_active_uq').on(t.workspaceId, t.runtime).where(sql`${t.liftedAt} is null`),
  ],
);

/** Where each agent sits in the office (S6-2). One desk per agent, and a numbered desk is held by one agent only. */
export const officeDesks = pgTable(
  'office_desks',
  {
    id: id(),
    workspaceId: workspaceId(),
    agentId: uuid('agent_id').notNull(),
    room: text('room').notNull(), // a room name from the office map
    slot: integer('slot'), // the desk number; null in the lounge, which has none
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('office_desks_ws_id_uq').on(t.workspaceId, t.id),
    unique('office_desks_ws_agent_uq').on(t.workspaceId, t.agentId),
    unique('office_desks_ws_room_slot_uq').on(t.workspaceId, t.room, t.slot),
    check('office_desks_slot_ck', sql`${t.slot} is null or ${t.slot} >= 1`),
    foreignKey({ name: 'office_desks_agent_fk', columns: [t.workspaceId, t.agentId], foreignColumns: [agents.workspaceId, agents.id] }).onDelete('cascade'),
  ],
);

/** A department's channel (S6-13d): short messages between its agents and the owner. Author is 'founder' or 'agent:<key>'. */
export const departmentMessages = pgTable(
  'department_messages',
  {
    id: id(),
    workspaceId: workspaceId(),
    departmentId: uuid('department_id').notNull(),
    author: text('author').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('department_messages_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ name: 'department_messages_department_fk', columns: [t.workspaceId, t.departmentId], foreignColumns: [departments.workspaceId, departments.id] }).onDelete('cascade'),
  ],
);

/** The Boardroom (SPEC 4, S6-10): a stored thread. A stand-up, a weekly review or a discussion someone opened. */
export const discussions = pgTable(
  'discussions',
  {
    id: id(),
    workspaceId: workspaceId(),
    kind: text('kind').notNull(), // standup | weekly | adhoc
    question: text('question').notNull(),
    status: text('status').notNull().default('open'), // open | closed
    openedBy: text('opened_by').notNull(), // 'founder' or 'agent:<key>'
    participants: jsonb('participants').notNull().default(sql`'[]'::jsonb`), // agent keys; empty means any agent of the company
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    unique('discussions_ws_id_uq').on(t.workspaceId, t.id),
    check('discussions_kind_ck', sql`${t.kind} in ('standup', 'weekly', 'adhoc')`),
    check('discussions_status_ck', sql`${t.status} in ('open', 'closed')`),
  ],
);

/** One turn in a discussion. A turn must carry evidence the OS has checked against its own tables (S6-10). */
export const discussionTurns = pgTable(
  'discussion_turns',
  {
    id: id(),
    workspaceId: workspaceId(),
    discussionId: uuid('discussion_id').notNull(),
    speaker: text('speaker').notNull(), // an agent key
    round: smallint('round').notNull(),
    body: text('body').notNull(),
    evidence: jsonb('evidence').notNull().default(sql`'[]'::jsonb`),
    disagreements: text('disagreements'), // a summary turn says where the leads disagree
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('discussion_turns_ws_id_uq').on(t.workspaceId, t.id),
    unique('discussion_turns_once_uq').on(t.workspaceId, t.discussionId, t.speaker, t.round),
    check('discussion_turns_round_ck', sql`${t.round} between 1 and 3`),
    foreignKey({ name: 'discussion_turns_discussion_fk', columns: [t.workspaceId, t.discussionId], foreignColumns: [discussions.workspaceId, discussions.id] }).onDelete('cascade'),
  ],
);

/** The decision log (S6-10). Only a person records a decision; agents read the log before proposing something already rejected. */
export const decisions = pgTable(
  'decisions',
  {
    id: id(),
    workspaceId: workspaceId(),
    discussionId: uuid('discussion_id'),
    title: text('title').notNull(),
    decision: text('decision').notNull(),
    owner: text('owner'),
    due: date('due'),
    decidedBy: text('decided_by').notNull().default('founder'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('decisions_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ name: 'decisions_discussion_fk', columns: [t.workspaceId, t.discussionId], foreignColumns: [discussions.workspaceId, discussions.id] }),
  ],
);

/** A device that asked for push notifications (S5-10). Stored once per endpoint. */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    workspaceId: workspaceId(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    failures: integer('failures').notNull().default(0), // in a row; five drops the subscription
    lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique('push_subscriptions_ws_id_uq').on(t.workspaceId, t.id), unique('push_subscriptions_ws_endpoint_uq').on(t.workspaceId, t.endpoint)],
);

/** One row per notification already handled, so each is sent exactly once (S5-10). */
export const pushEvents = pgTable(
  'push_events',
  {
    id: id(),
    workspaceId: workspaceId(),
    kind: text('kind').notNull(), // approval_waiting | executor_failed | brief
    ref: text('ref').notNull(), // the approval id, or the brief's day
    sent: integer('sent').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [unique('push_events_ws_id_uq').on(t.workspaceId, t.id), unique('push_events_ws_kind_ref_uq').on(t.workspaceId, t.kind, t.ref), check('push_events_kind_ck', sql`${t.kind} in ('approval_waiting','executor_failed','brief')`)],
);

/** A video brief: a script and a shot list a person approves before any credits are spent (S5-8). */
export const videoBriefs = pgTable(
  'video_briefs',
  {
    id: id(),
    workspaceId: workspaceId(),
    ideaId: uuid('idea_id').notNull(),
    title: text('title').notNull(),
    script: text('script').notNull(),
    shots: jsonb('shots').notNull(), // [{ kind: text | image | clip, description, seconds }]
    status: text('status').notNull().default('pending_approval'), // pending_approval | approved | rejected | expired | generating | generated | ready | review_failed | published | failed | cancelled
    estimatedCredits: integer('estimated_credits').notNull(), // counted from the shot list, never taken from the agent
    spentCredits: integer('spent_credits').notNull().default(0),
    approvalId: uuid('approval_id'),
    error: text('error'),
    plan: jsonb('plan'), // the assembly plan (S5-9)
    planHash: text('plan_hash'),
    review: jsonb('review'), // { ok, reasons }
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('video_briefs_ws_id_uq').on(t.workspaceId, t.id),
    // One live brief per idea. A rejected, expired or cancelled one does not stop a new one.
    uniqueIndex('video_briefs_live_idea_uq')
      .on(t.workspaceId, t.ideaId)
      .where(sql`${t.status} not in ('rejected','expired','cancelled','failed')`),
    check('video_briefs_status_ck', sql`${t.status} in ('pending_approval','approved','rejected','expired','generating','generated','ready','review_failed','published','failed','cancelled')`),
    check('video_briefs_credits_ck', sql`${t.estimatedCredits} >= 0 and ${t.spentCredits} >= 0`),
    foreignKey({ name: 'video_briefs_idea_fk', columns: [t.workspaceId, t.ideaId], foreignColumns: [videoIdeas.workspaceId, videoIdeas.id] }),
    foreignKey({ name: 'video_briefs_approval_fk', columns: [t.workspaceId, t.approvalId], foreignColumns: [approvals.workspaceId, approvals.id] }),
  ],
);

/** A generated image or clip, stored by key in the data folder (S5-8). */
export const videoAssets = pgTable(
  'video_assets',
  {
    id: id(),
    workspaceId: workspaceId(),
    briefId: uuid('brief_id').notNull(),
    shot: integer('shot').notNull(), // 1-based position in the shot list
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    mime: text('mime').notNull(),
    credits: integer('credits').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('video_assets_ws_id_uq').on(t.workspaceId, t.id),
    unique('video_assets_brief_shot_uq').on(t.workspaceId, t.briefId, t.shot),
    foreignKey({ name: 'video_assets_brief_fk', columns: [t.workspaceId, t.briefId], foreignColumns: [videoBriefs.workspaceId, videoBriefs.id] }),
  ],
);

/** A line, a link or a voice note dropped into the Video Ideas inbox (S5-7). */
export const videoIdeas = pgTable(
  'video_ideas',
  {
    id: id(),
    workspaceId: workspaceId(),
    source: text('source').notNull(), // founder | hook_scout
    idea: text('idea').notNull(),
    kind: text('kind').notNull().default('line'), // line | link | voice (a voice note is kept as its transcript)
    url: text('url'),
    hookId: uuid('hook_id'),
    stage: text('stage').notNull().default('idea'), // idea | shelved | brief | assets | render | review | published
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('video_ideas_ws_id_uq').on(t.workspaceId, t.id),
    index('video_ideas_ws_stage_idx').on(t.workspaceId, t.stage, t.createdAt),
    check('video_ideas_source_ck', sql`${t.source} in ('founder','hook_scout')`),
    check('video_ideas_kind_ck', sql`${t.kind} in ('line','link','voice')`),
    check('video_ideas_stage_ck', sql`${t.stage} in ('idea','shelved','brief','assets','render','review','published')`),
    foreignKey({ name: 'video_ideas_hook_fk', columns: [t.workspaceId, t.hookId], foreignColumns: [hooks.workspaceId, hooks.id] }),
  ],
);

/** A pattern that is working in the niche, with a link to the example and never a copy of it (S5-6). */
export const hooks = pgTable(
  'hooks',
  {
    id: id(),
    workspaceId: workspaceId(),
    pattern: text('pattern').notNull(),
    format: text('format'),
    platform: text('platform'),
    exampleUrl: text('example_url').notNull(), // normalised, so the same example is one hook
    notes: text('notes'),
    score: smallint('score'), // how well it held attention on our own account, set by results, not by the scout
    foundBy: text('found_by').notNull(),
    foundAt: timestamp('found_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('hooks_ws_id_uq').on(t.workspaceId, t.id), unique('hooks_ws_example_uq').on(t.workspaceId, t.exampleUrl), check('hooks_score_ck', sql`${t.score} is null or ${t.score} between 0 and 100`)],
);

/** A direct message an agent proposed to send to one person (S5-4). One row, one person, one approval. */
export const dms = pgTable(
  'dms',
  {
    id: id(),
    workspaceId: workspaceId(),
    channelAccountId: uuid('channel_account_id').notNull(),
    channel: text('channel').notNull(), // x_dm | ig_dm
    leadId: uuid('lead_id').notNull(),
    recipient: text('recipient').notNull(), // the handle, lower-case, without @
    text: text('text').notNull(),
    textHash: text('text_hash').notNull(),
    status: text('status').notNull().default('proposed'), // proposed | approved | sending | sent | rejected | expired | failed | cancelled
    approvalId: uuid('approval_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }), // when the executor started sending: the gap between sends counts from it
    sentAt: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('dms_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('dms_live_uq')
      .on(t.workspaceId, t.channelAccountId, t.recipient, t.textHash)
      .where(sql`${t.status} not in ('rejected','expired','cancelled')`),
    index('dms_account_sent_idx').on(t.workspaceId, t.channelAccountId, t.status, t.sentAt),
    check('dms_channel_ck', sql`${t.channel} in ('x_dm','ig_dm')`),
    check('dms_status_ck', sql`${t.status} in ('proposed','approved','sending','sent','rejected','expired','failed','cancelled')`),
    foreignKey({ name: 'dms_account_fk', columns: [t.workspaceId, t.channelAccountId], foreignColumns: [channelAccounts.workspaceId, channelAccounts.id] }),
    foreignKey({ name: 'dms_lead_fk', columns: [t.workspaceId, t.leadId], foreignColumns: [leads.workspaceId, leads.id] }),
    foreignKey({ name: 'dms_approval_fk', columns: [t.workspaceId, t.approvalId], foreignColumns: [approvals.workspaceId, approvals.id] }),
  ],
);

/** A post an agent proposed to publish (S5-1). The approval is what makes it go out; this row follows it to the result. */
export const posts = pgTable(
  'posts',
  {
    id: id(),
    workspaceId: workspaceId(),
    channelAccountId: uuid('channel_account_id').notNull(),
    platform: text('platform').notNull(), // x | linkedin | instagram
    text: text('text').notNull(),
    textHash: text('text_hash').notNull(), // spacing and case do not make a post new
    status: text('status').notNull().default('proposed'), // proposed | approved | publishing | published | rejected | expired | failed | cancelled
    approvalId: uuid('approval_id'),
    videoBriefId: uuid('video_brief_id'), // a reviewed video attached to this post (S5-11)
    publishedUrl: text('published_url'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    error: text('error'),
    createdBy: text('created_by').notNull(), // agent:<key> or founder
    createdAt: createdAt(),
  },
  (t) => [
    unique('posts_ws_id_uq').on(t.workspaceId, t.id),
    // One live post per account and text. A rejected, expired or cancelled one does not stop the same words being proposed again.
    uniqueIndex('posts_live_text_uq')
      .on(t.workspaceId, t.channelAccountId, t.textHash)
      .where(sql`${t.status} not in ('rejected','expired','cancelled')`),
    index('posts_ws_status_idx').on(t.workspaceId, t.status, t.createdAt),
    // A video goes out in one live post at a time.
    uniqueIndex('posts_live_video_uq')
      .on(t.workspaceId, t.videoBriefId)
      .where(sql`${t.videoBriefId} is not null and ${t.status} not in ('rejected','expired','cancelled','failed')`),
    foreignKey({ name: 'posts_video_brief_fk', columns: [t.workspaceId, t.videoBriefId], foreignColumns: [videoBriefs.workspaceId, videoBriefs.id] }),
    check('posts_platform_ck', sql`${t.platform} in ('x','linkedin','instagram')`),
    check('posts_status_ck', sql`${t.status} in ('proposed','approved','publishing','published','rejected','expired','failed','cancelled')`),
    foreignKey({ name: 'posts_account_fk', columns: [t.workspaceId, t.channelAccountId], foreignColumns: [channelAccounts.workspaceId, channelAccounts.id] }),
    foreignKey({ name: 'posts_approval_fk', columns: [t.workspaceId, t.approvalId], foreignColumns: [approvals.workspaceId, approvals.id] }),
  ],
);

/** What the scouts find (S4-6): a public post or page with a reason to act on it. One per web address. */
export const signals = pgTable(
  'signals',
  {
    id: id(),
    workspaceId: workspaceId(),
    departmentId: uuid('department_id'),
    kind: text('kind').notNull(), // service_request | pain_point | tool_news
    source: text('source').notNull(), // reddit, x, a forum, a job board
    url: text('url').notNull(), // normalised: the same post found twice is one signal
    author: text('author'),
    excerpt: text('excerpt'),
    status: text('status').notNull().default('new'), // new | qualified | dismissed | promoted
    score: smallint('score'),
    reason: text('reason'),
    leadId: uuid('lead_id'),
    foundBy: text('found_by').notNull(), // founder | agent:<key>
    foundAt: timestamp('found_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('signals_ws_id_uq').on(t.workspaceId, t.id),
    unique('signals_ws_url_uq').on(t.workspaceId, t.url),
    index('signals_ws_status_idx').on(t.workspaceId, t.status, t.foundAt),
    check('signals_kind_ck', sql`${t.kind} in ('service_request','pain_point','tool_news')`),
    check('signals_status_ck', sql`${t.status} in ('new','qualified','dismissed','promoted')`),
    check('signals_score_ck', sql`${t.score} is null or ${t.score} between 0 and 100`),
    foreignKey({ name: 'signals_department_fk', columns: [t.workspaceId, t.departmentId], foreignColumns: [departments.workspaceId, departments.id] }),
    foreignKey({ name: 'signals_lead_fk', columns: [t.workspaceId, t.leadId], foreignColumns: [leads.workspaceId, leads.id] }),
  ],
);

/** One breaker per tool, such as os:add_lead. Three failures in a row open it for a cooldown (S3-6). */
export const circuitBreakers = pgTable(
  'circuit_breakers',
  {
    id: id(),
    workspaceId: workspaceId(),
    key: text('key').notNull(),
    state: text('state').notNull().default('closed'), // closed | open
    failures: integer('failures').notNull().default(0),
    lastError: text('last_error'),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    openUntil: timestamp('open_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('circuit_breakers_ws_id_uq').on(t.workspaceId, t.id), unique('circuit_breakers_ws_key_uq').on(t.workspaceId, t.key), check('circuit_breakers_state_ck', sql`${t.state} in ('closed','open')`)],
);

/** Every message drafted or sent to a lead, one row per message. */
export const outreachMessages = pgTable(
  'outreach_messages',
  {
    id: id(),
    workspaceId: workspaceId(),
    leadId: uuid('lead_id').notNull(),
    channel: text('channel').notNull().default('email'), // email | x_dm | ig_dm | linkedin | call
    step: smallint('step').notNull().default(1),
    direction: text('direction').notNull().default('out'),
    toAddress: text('to_address'),
    subject: text('subject'),
    body: text('body'),
    approvalId: uuid('approval_id'),
    campaignId: uuid('campaign_id'),
    channelAccountId: uuid('channel_account_id'),
    status: text('status').notNull().default('draft'), // draft | queued | sent | failed | refused | rejected | expired
    sentAt: timestamp('sent_at', { withTimezone: true }),
    externalRef: text('external_ref'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('outreach_ws_id_uq').on(t.workspaceId, t.id),
    index('outreach_ws_sent_idx').on(t.workspaceId, t.channel, t.sentAt),
    foreignKey({ name: 'outreach_lead_fk', columns: [t.workspaceId, t.leadId], foreignColumns: [leads.workspaceId, leads.id] }),
    foreignKey({ name: 'outreach_approval_fk', columns: [t.workspaceId, t.approvalId], foreignColumns: [approvals.workspaceId, approvals.id] }),
    foreignKey({ name: 'outreach_campaign_fk', columns: [t.workspaceId, t.campaignId], foreignColumns: [campaigns.workspaceId, campaigns.id] }),
    foreignKey({ name: 'outreach_channel_fk', columns: [t.workspaceId, t.channelAccountId], foreignColumns: [channelAccounts.workspaceId, channelAccounts.id] }),
    index('outreach_channel_sent_idx').on(t.workspaceId, t.channelAccountId, t.sentAt),
  ],
);

/** One list per workspace. Executors check it at send time (SPEC 10). */
export const suppression = pgTable(
  'suppression',
  {
    id: id(),
    workspaceId: workspaceId(),
    value: text('value').notNull(), // a lowercased email address or a domain such as @example.com
    reason: text('reason'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('suppression_ws_value_uq').on(t.workspaceId, t.value), unique('suppression_ws_id_uq').on(t.workspaceId, t.id)],
);

/** The kill switch and the daily email cap (SPEC 11, slice 1). One row per workspace. */
export const workspaceSettings = pgTable('workspace_settings', {
  workspaceId: uuid('workspace_id').primaryKey().references(() => workspaces.id),
  killSwitch: smallint('kill_switch').notNull().default(0), // 1 = everything stopped
  killSwitchAt: timestamp('kill_switch_at', { withTimezone: true }),
  // Sends are capped two ways, both settings. A rolling window (default 30 in 5 hours; follow-ups count) and a per-day cap.
  // An email over a cap is held, not failed, and goes out when there is room.
  windowHours: integer('window_hours').notNull().default(5),
  windowCap: integer('window_cap').notNull().default(30),
  emailDailyCap: integer('email_daily_cap').notNull().default(100),
  // How autonomous hiring may be (S8-6): H0 nothing alone, H1 trials inside a mandate. The roster cap counts active agents.
  hiringLevel: text('hiring_level').notNull().default('H0'),
  rosterCap: integer('roster_cap').notNull().default(20),
  trialBudgetCapUsd: numeric('trial_budget_cap_usd', { precision: 10, scale: 2 }).notNull().default('5'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
(t) => [
  // Sanity limits, the same ones the API enforces: a cap of zero or a window of a year is a mistake, not a setting.
  check('workspace_settings_limits_ck', sql`${t.windowHours} between 1 and 168 and ${t.windowCap} between 1 and 100000 and ${t.emailDailyCap} between 1 and 100000`),
  check('workspace_settings_hiring_ck', sql`${t.hiringLevel} in ('H0','H1') and ${t.rosterCap} between 1 and 500`),
]);

/** Things that need a person: a failed executor, a send of unknown outcome, an agent's question. */
export const actionItems = pgTable(
  'action_items',
  {
    id: id(),
    workspaceId: workspaceId(),
    kind: text('kind').notNull(), // executor_failed | send_unknown | question
    title: text('title').notNull(),
    body: text('body'),
    approvalId: uuid('approval_id'),
    taskId: uuid('task_id'),
    status: text('status').notNull().default('open'), // open | done
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    resolutionNote: text('resolution_note'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('action_items_ws_id_uq').on(t.workspaceId, t.id),
    // One item per approval and kind: a failure that is recorded twice still shows once.
    uniqueIndex('action_items_approval_kind_uq').on(t.workspaceId, t.approvalId, t.kind).where(sql`${t.approvalId} is not null`),
    foreignKey({ name: 'action_items_task_fk', columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id] }),
    foreignKey({ name: 'action_items_approval_fk', columns: [t.workspaceId, t.approvalId], foreignColumns: [approvals.workspaceId, approvals.id] }),
  ],
);

/** A project (S7-1): a registered git folder with its test and build commands, the thing a coding task works on. Never inside this repo. */
export const codeProjects = pgTable(
  'code_projects',
  {
    id: id(),
    workspaceId: workspaceId(),
    key: text('key').notNull(),
    path: text('path').notNull(),
    defaultBranch: text('default_branch').notNull(),
    testCmd: text('test_cmd'),
    buildCmd: text('build_cmd'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('code_projects_ws_id_uq').on(t.workspaceId, t.id), unique('code_projects_ws_key_uq').on(t.workspaceId, t.key), unique('code_projects_ws_path_uq').on(t.workspaceId, t.path)],
);

/** A coding task's git worktree (S7-5): where it works, on which branch, cut from which. One per task; closed when the task is done. */
export const codeWorktrees = pgTable(
  'code_worktrees',
  {
    id: id(),
    workspaceId: workspaceId(),
    taskId: uuid('task_id').notNull(),
    projectId: uuid('project_id').notNull(),
    path: text('path').notNull(),
    branch: text('branch').notNull(),
    baseBranch: text('base_branch').notNull(),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    unique('code_worktrees_ws_id_uq').on(t.workspaceId, t.id),
    unique('code_worktrees_ws_task_uq').on(t.workspaceId, t.taskId),
    foreignKey({ name: 'code_worktrees_task_fk', columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id] }),
    foreignKey({ name: 'code_worktrees_project_fk', columns: [t.workspaceId, t.projectId], foreignColumns: [codeProjects.workspaceId, codeProjects.id] }),
    check('code_worktrees_status_ck', sql`${t.status} in ('open','closed')`),
  ],
);

/** A pull request recorded by the git connector after an approved `pr.open` (S7-6). The local stand-in has no web page; this row is the record. */
export const codePullRequests = pgTable(
  'code_pull_requests',
  {
    id: id(),
    workspaceId: workspaceId(),
    approvalId: uuid('approval_id').notNull(),
    projectKey: text('project_key').notNull(),
    number: integer('number').notNull(),
    taskId: uuid('task_id'),
    branch: text('branch').notNull(),
    base: text('base').notNull(),
    head: text('head').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    status: text('status').notNull().default('open'),
    connector: text('connector').notNull(),
    url: text('url'),
    approvedBy: text('approved_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    mergedBy: text('merged_by'),
  },
  (t) => [
    unique('code_pull_requests_ws_id_uq').on(t.workspaceId, t.id),
    unique('code_pull_requests_ws_approval_uq').on(t.workspaceId, t.approvalId),
    unique('code_pull_requests_ws_project_number_uq').on(t.workspaceId, t.projectKey, t.number),
    foreignKey({ name: 'code_pull_requests_approval_fk', columns: [t.workspaceId, t.approvalId], foreignColumns: [approvals.workspaceId, approvals.id] }),
    check('code_pull_requests_status_ck', sql`${t.status} in ('open','merged','closed')`),
  ],
);

/** What is deployed where (S7-8): one row per approved deploy, live or failed, naming the commit, the preview address and who approved it. */
export const deployments = pgTable(
  'deployments',
  {
    id: id(),
    workspaceId: workspaceId(),
    approvalId: uuid('approval_id').notNull(),
    projectKey: text('project_key').notNull(),
    client: text('client'),
    ref: text('ref'),
    status: text('status').notNull().default('building'),
    url: text('url'),
    error: text('error'),
    approvedBy: text('approved_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    unique('deployments_ws_id_uq').on(t.workspaceId, t.id),
    unique('deployments_ws_approval_uq').on(t.workspaceId, t.approvalId),
    foreignKey({ name: 'deployments_approval_fk', columns: [t.workspaceId, t.approvalId], foreignColumns: [approvals.workspaceId, approvals.id] }),
    check('deployments_status_ck', sql`${t.status} in ('building','live','failed')`),
  ],
);

/** What the company has learned (S8-1): notes with a scope, a source and a confidence. Never the authority on a table or a rule. */
export const memories = pgTable(
  'memories',
  {
    id: id(),
    workspaceId: workspaceId(),
    scope: text('scope').notNull(),
    agentId: uuid('agent_id'),
    text: text('text').notNull(),
    source: text('source').notNull(),
    confidence: integer('confidence').notNull().default(60),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('memories_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ name: 'memories_agent_fk', columns: [t.workspaceId, t.agentId], foreignColumns: [agents.workspaceId, agents.id] }),
    check('memories_scope_ck', sql`${t.scope} in ('founder','company','market')`),
    check('memories_confidence_ck', sql`${t.confidence} between 0 and 100`),
  ],
);

/** A persona imported from a catalog (S8-4). Text from strangers: kept with its source, pinned id and licence, scanned, and never granted a tool. */
export const catalogRoles = pgTable(
  'catalog_roles',
  {
    id: id(),
    workspaceId: workspaceId(),
    source: text('source').notNull(),
    key: text('key').notNull(),
    division: text('division').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    text: text('text').notNull(),
    hash: text('hash').notNull(),
    pinnedId: text('pinned_id').notNull(),
    license: text('license').notNull(),
    flagged: boolean('flagged').notNull().default(false),
    flags: jsonb('flags').notNull().default(sql`'[]'::jsonb`),
    droppedKeys: jsonb('dropped_keys').notNull().default(sql`'[]'::jsonb`),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('catalog_roles_ws_id_uq').on(t.workspaceId, t.id), unique('catalog_roles_ws_source_key_uq').on(t.workspaceId, t.source, t.key)],
);

/** A bake-off (S8-5): candidates from the catalog, each run through the same trial and scored, boundaries first. */
export const bakeoffs = pgTable(
  'bakeoffs',
  {
    id: id(),
    workspaceId: workspaceId(),
    department: text('department').notNull(),
    query: text('query').notNull(),
    template: text('template').notNull(),
    trialTask: text('trial_task').notNull(),
    status: text('status').notNull().default('scored'),
    candidates: jsonb('candidates').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('bakeoffs_ws_id_uq').on(t.workspaceId, t.id), check('bakeoffs_status_ck', sql`${t.status} in ('scored','proposed')`)],
);

/** The delegate (S8-10): who may clear routine approvals in the founder's name. Only the public key is here; the private key is a file outside the repository. */
export const delegates = pgTable(
  'delegates',
  {
    id: id(),
    workspaceId: workspaceId(),
    publicKeyPem: text('public_key_pem').notNull(),
    fingerprint: text('fingerprint').notNull(),
    active: boolean('active').notNull().default(false),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    mandate: jsonb('mandate').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('delegates_ws_id_uq').on(t.workspaceId, t.id)],
);

/** What the delegate decided or refused, matched to the approval by id: who, why, and the signature (S8-10). */
export const delegateLedger = pgTable(
  'delegate_ledger',
  {
    id: id(),
    workspaceId: workspaceId(),
    approvalId: uuid('approval_id').notNull(),
    delegateId: uuid('delegate_id'),
    kind: text('kind').notNull(),
    outcome: text('outcome').notNull(),
    reason: text('reason'),
    reasoning: text('reasoning').notNull().default(''),
    signature: text('signature'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('delegate_ledger_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ name: 'delegate_ledger_approval_fk', columns: [t.workspaceId, t.approvalId], foreignColumns: [approvals.workspaceId, approvals.id] }),
    check('delegate_ledger_outcome_ck', sql`${t.outcome} in ('cleared','refused')`),
  ],
);

/** An improvement the Research room proposes (S8-11): evidence, an expected gain, and the result of the eval that has to pass first. */
export const improvements = pgTable(
  'improvements',
  {
    id: id(),
    workspaceId: workspaceId(),
    approvalId: uuid('approval_id'),
    skill: text('skill').notNull(),
    why: text('why').notNull(),
    expectedGain: text('expected_gain').notNull(),
    evidence: jsonb('evidence').notNull(),
    status: text('status').notNull(),
    evalOutput: text('eval_output').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('improvements_ws_id_uq').on(t.workspaceId, t.id), check('improvements_status_ck', sql`${t.status} in ('proposed','eval_failed')`)],
);

/** The first-run wizard's answers (S9-7): one row per step, answered again by writing over it. Never a key or a secret. */
export const setupSteps = pgTable(
  'setup_steps',
  {
    workspaceId: workspaceId(),
    step: text('step').notNull(),
    data: jsonb('data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'setup_steps_pkey', columns: [t.workspaceId, t.step] })],
);
