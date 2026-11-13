-- Custom migration: row-level security and grants for posts. Same rule as 0001.

alter table "posts" enable row level security;
--> statement-breakpoint
alter table "posts" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "posts"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "posts" to conclave_app;
