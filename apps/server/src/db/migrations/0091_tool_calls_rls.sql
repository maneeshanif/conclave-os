-- Custom migration: row-level security and grants for the tool_calls table (A3). Same rule as 0001.

alter table "tool_calls" enable row level security;
--> statement-breakpoint
alter table "tool_calls" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "tool_calls"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "tool_calls" to conclave_app;
--> statement-breakpoint
grant usage, select on sequence "tool_calls_id_seq" to conclave_app;
