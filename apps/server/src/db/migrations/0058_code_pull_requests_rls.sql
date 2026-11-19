-- Custom migration: row-level security and grants for the code pull requests table (S7-6). Same rule as 0001.

alter table "code_pull_requests" enable row level security;
--> statement-breakpoint
alter table "code_pull_requests" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "code_pull_requests"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "code_pull_requests" to conclave_app;
