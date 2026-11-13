-- Custom migration: row-level security and grants for signals. Same rule as 0001.

alter table "signals" enable row level security;
--> statement-breakpoint
alter table "signals" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "signals"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "signals" to conclave_app;
