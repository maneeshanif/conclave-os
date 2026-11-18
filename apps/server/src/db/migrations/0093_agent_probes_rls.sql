-- Custom migration: row-level security and grants for the agent_probes table (A4). Same rule as 0001.

alter table "agent_probes" enable row level security;
--> statement-breakpoint
alter table "agent_probes" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "agent_probes"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "agent_probes" to conclave_app;
