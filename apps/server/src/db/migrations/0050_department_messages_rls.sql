-- Custom migration: row-level security and grants for department messages. Same rule as 0001.

alter table "department_messages" enable row level security;
--> statement-breakpoint
alter table "department_messages" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "department_messages"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "department_messages" to conclave_app;
