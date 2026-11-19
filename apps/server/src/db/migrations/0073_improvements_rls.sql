-- Custom migration: row-level security and grants for the improvements table (S8-11). Same rule as 0001.

alter table "improvements" enable row level security;
--> statement-breakpoint
alter table "improvements" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "improvements"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "improvements" to conclave_app;
