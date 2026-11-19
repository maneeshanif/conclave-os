-- Custom migration: row-level security and grants for the network tables (S8-11b). Same rule as 0001.

alter table "network_people" enable row level security;
--> statement-breakpoint
alter table "network_people" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "network_people"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "network_people" to conclave_app;
--> statement-breakpoint
alter table "network_drafts" enable row level security;
--> statement-breakpoint
alter table "network_drafts" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "network_drafts"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "network_drafts" to conclave_app;
