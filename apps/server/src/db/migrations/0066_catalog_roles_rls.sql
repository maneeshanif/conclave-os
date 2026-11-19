-- Custom migration: row-level security and grants for the catalog_roles table (S8-4). Same rule as 0001.

alter table "catalog_roles" enable row level security;
--> statement-breakpoint
alter table "catalog_roles" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "catalog_roles"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "catalog_roles" to conclave_app;
