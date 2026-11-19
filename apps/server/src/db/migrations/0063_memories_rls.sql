-- Custom migration: row-level security and grants for the memories table (S8-1). Same rule as 0001.

alter table "memories" enable row level security;
--> statement-breakpoint
alter table "memories" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "memories"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "memories" to conclave_app;
