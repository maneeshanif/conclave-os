-- Custom migration: row-level security and grants for the deployments table (S7-8). Same rule as 0001.

alter table "deployments" enable row level security;
--> statement-breakpoint
alter table "deployments" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "deployments"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "deployments" to conclave_app;
