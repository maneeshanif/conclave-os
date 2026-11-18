-- Custom migration: row-level security and grants for the bakeoffs table (S8-5). Same rule as 0001.

alter table "bakeoffs" enable row level security;
--> statement-breakpoint
alter table "bakeoffs" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "bakeoffs"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "bakeoffs" to conclave_app;
