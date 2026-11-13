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
    createdAt: createdAt(),
  },
  (t) => [
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
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
(t) => [
  // Sanity limits, the same ones the API enforces: a cap of zero or a window of a year is a mistake, not a setting.
  check('workspace_settings_limits_ck', sql`${t.windowHours} between 1 and 168 and ${t.windowCap} between 1 and 100000 and ${t.emailDailyCap} between 1 and 100000`),
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
