-- Custom migration: row-level security and grants for circuit breakers. Same rule as 0001.

alter table "circuit_breakers" enable row level security;
--> statement-breakpoint
alter table "circuit_breakers" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "circuit_breakers"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "circuit_breakers" to conclave_app;
