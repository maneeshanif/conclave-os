-- Custom migration: row-level security, policies and grants. SPEC 11, "The tenancy rule".
-- Runs as conclave_owner. The roles and the database are created before migrations run
-- (src/db/embedded.ts), because the owner cannot create roles.
--
-- Every policy uses nullif(current_setting('app.workspace_id', true), '')::uuid, never a bare cast.
-- On a pooled connection that once ran set_config(..., true) the setting reads as '' rather than null,
-- and ''::uuid raises an error instead of returning no rows.

revoke create on schema public from public;
--> statement-breakpoint
grant usage on schema public to conclave_app;
--> statement-breakpoint

alter table "workspaces" enable row level security;
--> statement-breakpoint
alter table "workspaces" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "workspaces"
  using      ("id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "members" enable row level security;
--> statement-breakpoint
alter table "members" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "members"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "departments" enable row level security;
--> statement-breakpoint
alter table "departments" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "departments"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "agent_templates" enable row level security;
--> statement-breakpoint
alter table "agent_templates" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "agent_templates"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "agents" enable row level security;
--> statement-breakpoint
alter table "agents" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "agents"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "goals" enable row level security;
--> statement-breakpoint
alter table "goals" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "goals"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "tasks" enable row level security;
--> statement-breakpoint
alter table "tasks" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "tasks"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "runs" enable row level security;
--> statement-breakpoint
alter table "runs" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "runs"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "run_events" enable row level security;
--> statement-breakpoint
alter table "run_events" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "run_events"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "approvals" enable row level security;
--> statement-breakpoint
alter table "approvals" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "approvals"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "messages" enable row level security;
--> statement-breakpoint
alter table "messages" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "messages"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "audit_log" enable row level security;
--> statement-breakpoint
alter table "audit_log" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "audit_log"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Grants. The request role gets DML on the tables above and nothing else: no DDL, no default
-- privileges. A table added later is invisible to the request role until its own migration
-- enables, forces and polices it, and grants on it; the tenancy test fails if a table skips that.
grant select, insert, update, delete on
  "workspaces", "members", "departments", "agent_templates", "agents", "goals",
  "tasks", "runs", "run_events", "approvals", "messages", "audit_log"
  to conclave_app;
--> statement-breakpoint
grant usage, select on sequence "run_events_id_seq", "audit_log_id_seq" to conclave_app;
