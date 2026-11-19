-- Custom migration: row-level security and grants for hooks. Same rule as 0001.

alter table "hooks" enable row level security;
--> statement-breakpoint
alter table "hooks" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "hooks"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "hooks" to conclave_app;
