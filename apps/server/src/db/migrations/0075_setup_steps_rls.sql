-- Custom migration: row-level security and grants for the setup_steps table (S9-7). Same rule as 0001.

alter table "setup_steps" enable row level security;
--> statement-breakpoint
alter table "setup_steps" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "setup_steps"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "setup_steps" to conclave_app;
