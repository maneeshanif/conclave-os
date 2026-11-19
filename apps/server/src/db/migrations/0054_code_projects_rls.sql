-- Custom migration: row-level security and grants for the code projects table (S7-1). Same rule as 0001.

alter table "code_projects" enable row level security;
--> statement-breakpoint
alter table "code_projects" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "code_projects"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "code_projects" to conclave_app;
