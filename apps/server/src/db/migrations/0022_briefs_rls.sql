-- Custom migration: row-level security and grants for the morning brief table. Same rule as 0001.

alter table "briefs" enable row level security;
--> statement-breakpoint
alter table "briefs" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "briefs"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "briefs" to conclave_app;
