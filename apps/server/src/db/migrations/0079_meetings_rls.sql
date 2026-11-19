-- Custom migration: row-level security and grants for the meetings tables (S10-1). Same rule as 0001.

alter table "meetings" enable row level security;
--> statement-breakpoint
alter table "meetings" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "meetings"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "meetings" to conclave_app;
--> statement-breakpoint
alter table "guest_links" enable row level security;
--> statement-breakpoint
alter table "guest_links" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "guest_links"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "guest_links" to conclave_app;
