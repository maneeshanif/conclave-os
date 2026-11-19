-- Custom migration: row-level security and grants for the crm_conflicts table (S10-8). Same rule as 0001.

alter table "crm_conflicts" enable row level security;
--> statement-breakpoint
alter table "crm_conflicts" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "crm_conflicts"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "crm_conflicts" to conclave_app;
