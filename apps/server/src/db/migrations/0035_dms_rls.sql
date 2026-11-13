-- Custom migration: row-level security and grants for dms. Same rule as 0001.

alter table "dms" enable row level security;
--> statement-breakpoint
alter table "dms" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "dms"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "dms" to conclave_app;
