-- Custom migration: row-level security and grants for the spend_adjustments table (A5). Same rule as 0001.

alter table "spend_adjustments" enable row level security;
--> statement-breakpoint
alter table "spend_adjustments" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "spend_adjustments"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "spend_adjustments" to conclave_app;
