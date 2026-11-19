-- Custom migration: row-level security and grants for the delegate tables (S8-10). Same rule as 0001.

alter table "delegates" enable row level security;
--> statement-breakpoint
alter table "delegates" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "delegates"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "delegates" to conclave_app;
--> statement-breakpoint
alter table "delegate_ledger" enable row level security;
--> statement-breakpoint
alter table "delegate_ledger" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "delegate_ledger"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "delegate_ledger" to conclave_app;
