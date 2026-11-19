-- Custom migration: row-level security and grants for the slice 2 CRM tables. Same rule as 0001.

alter table "accounts" enable row level security;
--> statement-breakpoint
alter table "accounts" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "accounts"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "accounts" to conclave_app;
--> statement-breakpoint

alter table "contacts" enable row level security;
--> statement-breakpoint
alter table "contacts" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "contacts"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "contacts" to conclave_app;
--> statement-breakpoint

alter table "deals" enable row level security;
--> statement-breakpoint
alter table "deals" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "deals"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "deals" to conclave_app;
--> statement-breakpoint
