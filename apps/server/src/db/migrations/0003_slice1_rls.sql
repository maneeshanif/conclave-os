-- Custom migration: row-level security and grants for the slice 1 tables. Same rule as 0001.

alter table "leads" enable row level security;
--> statement-breakpoint
alter table "leads" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "leads"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "leads" to conclave_app;
--> statement-breakpoint

alter table "outreach_messages" enable row level security;
--> statement-breakpoint
alter table "outreach_messages" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "outreach_messages"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "outreach_messages" to conclave_app;
--> statement-breakpoint

alter table "suppression" enable row level security;
--> statement-breakpoint
alter table "suppression" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "suppression"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "suppression" to conclave_app;
--> statement-breakpoint

alter table "workspace_settings" enable row level security;
--> statement-breakpoint
alter table "workspace_settings" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "workspace_settings"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "workspace_settings" to conclave_app;
--> statement-breakpoint

alter table "action_items" enable row level security;
--> statement-breakpoint
alter table "action_items" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "action_items"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "action_items" to conclave_app;
