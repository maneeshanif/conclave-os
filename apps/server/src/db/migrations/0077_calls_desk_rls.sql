-- Custom migration: row-level security and grants for the call_list_items table (S9-8). Same rule as 0001.

alter table "call_list_items" enable row level security;
--> statement-breakpoint
alter table "call_list_items" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "call_list_items"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "call_list_items" to conclave_app;
