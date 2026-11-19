-- Custom migration: row-level security and grants for runtime pauses. Same rule as 0001.

alter table "runtime_pauses" enable row level security;
--> statement-breakpoint
alter table "runtime_pauses" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "runtime_pauses"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "runtime_pauses" to conclave_app;
