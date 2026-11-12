-- Slice 0: the twelve tables exactly as SPEC 11 gives them, then row-level security and grants.
-- Runs as conclave_owner, which then owns every table.

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text not null unique,
  mode text not null default 'local',              -- local | team
  created_at timestamptz not null default now()
);
create table members (
  workspace_id uuid not null references workspaces(id), user_id text not null,
  role text not null check (role in ('owner','admin','member','viewer')),
  primary key (workspace_id, user_id)
);
create table departments (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  key text not null, name text not null, lead_agent_id uuid, room jsonb not null default '{}',
  unique (workspace_id, key), unique (workspace_id, id)
  -- foreign key (workspace_id, lead_agent_id) references agents (workspace_id, id): added after agents exists
);
create table agent_templates (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  key text not null, version int not null default 1, path text not null,
  unique (workspace_id, key), unique (workspace_id, id)
);
create table agents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  key text not null, name text not null,
  department_id uuid not null, reports_to uuid,
  template_id uuid, template_version int,
  runtime text not null check (runtime in ('claude-cli','opencode','openai-agents','codex','http','claude-agent')),
  model_alias text not null, fallback_alias text, heartbeat_cron text,
  autonomy smallint not null default 0, max_turns int not null default 25, output_check text,
  monthly_budget_usd numeric(10,2) not null default 5,
  status text not null default 'pending_approval', -- pending_approval | active | paused | retired
  role_path text not null, created_at timestamptz not null default now(),
  unique (workspace_id, key), unique (workspace_id, id),
  foreign key (workspace_id, department_id) references departments (workspace_id, id),
  foreign key (workspace_id, reports_to)    references agents (workspace_id, id),
  foreign key (workspace_id, template_id)   references agent_templates (workspace_id, id)
);
alter table departments
  add foreign key (workspace_id, lead_agent_id) references agents (workspace_id, id);
create table goals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  key text not null, kind text not null,           -- rung | department
  parent_id uuid, department_id uuid,
  title text, metric text, target numeric, source text, due date,
  status text not null default 'active',
  unique (workspace_id, key), unique (workspace_id, id),
  foreign key (workspace_id, parent_id)     references goals (workspace_id, id),
  foreign key (workspace_id, department_id) references departments (workspace_id, id)
);
create table tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  goal_id uuid, parent_id uuid, department_id uuid, assignee_id uuid,
  title text not null, body text, kind text not null default 'general',
  status text not null default 'todo',  -- todo | in_progress | waiting_approval | blocked | done | cancelled
  priority smallint not null default 3, blocked_reason text,
  locked_by uuid, locked_at timestamptz, session_id text,
  subject_type text, subject_id uuid,
  created_by text not null, created_at timestamptz not null default now(), done_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, goal_id)       references goals (workspace_id, id),
  foreign key (workspace_id, parent_id)     references tasks (workspace_id, id),
  foreign key (workspace_id, department_id) references departments (workspace_id, id),
  foreign key (workspace_id, assignee_id)   references agents (workspace_id, id)
);
create index on tasks (workspace_id, assignee_id, status, priority, created_at);
create table runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  agent_id uuid not null, task_id uuid,
  trigger text not null, runtime text not null, model text, session_id text,
  status text not null default 'queued', -- queued | running | waiting_approval | succeeded | failed | cancelled | timed_out
  attempt smallint not null default 1, heartbeat_at timestamptz,
  started_at timestamptz, ended_at timestamptz,
  tokens_in int default 0, tokens_out int default 0, cost_usd numeric(10,4) default 0, error text,
  unique (workspace_id, id),
  foreign key (workspace_id, agent_id) references agents (workspace_id, id),
  foreign key (workspace_id, task_id)  references tasks (workspace_id, id)
);
create table run_events (
  id bigserial primary key, workspace_id uuid not null references workspaces(id),
  run_id uuid not null,
  at timestamptz not null default now(), type text not null, data jsonb not null,
  unique (workspace_id, id),
  foreign key (workspace_id, run_id) references runs (workspace_id, id)
);
create table approvals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  kind text not null, dedupe_key text not null,
  agent_id uuid, run_id uuid, task_id uuid,
  payload jsonb not null, edited_payload jsonb,
  status text not null default 'pending', -- pending | approved | executing | executed | rejected | expired | failed
  decided_by text, decided_at timestamptz, decided_device text, decision_note text,
  result jsonb, created_at timestamptz not null default now(),
  unique (workspace_id, kind, dedupe_key), unique (workspace_id, id),
  foreign key (workspace_id, agent_id) references agents (workspace_id, id),
  foreign key (workspace_id, run_id)   references runs (workspace_id, id),
  foreign key (workspace_id, task_id)  references tasks (workspace_id, id)
);
create table messages (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  task_id uuid, from_id text not null, to_id text,
  body text not null, created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, task_id) references tasks (workspace_id, id)
);
create table audit_log (
  id bigserial primary key, workspace_id uuid not null references workspaces(id),
  at timestamptz not null default now(), actor text not null, action text not null,
  subject text, data jsonb not null default '{}',
  unique (workspace_id, id)
);

-- Row-level security, forced, on every table (SPEC 11, the tenancy rule).
alter table members enable row level security;
alter table members force row level security;
create policy tenant_isolation on members
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table departments enable row level security;
alter table departments force row level security;
create policy tenant_isolation on departments
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table agent_templates enable row level security;
alter table agent_templates force row level security;
create policy tenant_isolation on agent_templates
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table agents enable row level security;
alter table agents force row level security;
create policy tenant_isolation on agents
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table goals enable row level security;
alter table goals force row level security;
create policy tenant_isolation on goals
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table tasks enable row level security;
alter table tasks force row level security;
create policy tenant_isolation on tasks
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table runs enable row level security;
alter table runs force row level security;
create policy tenant_isolation on runs
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table run_events enable row level security;
alter table run_events force row level security;
create policy tenant_isolation on run_events
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table approvals enable row level security;
alter table approvals force row level security;
create policy tenant_isolation on approvals
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table messages enable row level security;
alter table messages force row level security;
create policy tenant_isolation on messages
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy tenant_isolation on audit_log
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
alter table workspaces enable row level security;
alter table workspaces force row level security;
create policy tenant_isolation on workspaces
  using      (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The request role: data only, no DDL (SPEC 11, three roles).
grant usage on schema public to conclave_app;
grant select, insert, update, delete on all tables in schema public to conclave_app;
grant usage, select on all sequences in schema public to conclave_app;
revoke all on _migrations from conclave_app;
