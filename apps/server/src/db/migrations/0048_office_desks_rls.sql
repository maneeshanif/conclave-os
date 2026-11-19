-- Custom migration: row-level security and grants for office desks. Same rule as 0001.

alter table "office_desks" enable row level security;
--> statement-breakpoint
alter table "office_desks" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "office_desks"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "office_desks" to conclave_app;
