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
    heartbeatCron: text('heartbeat_cron'),
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
