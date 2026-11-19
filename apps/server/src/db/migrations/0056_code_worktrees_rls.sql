-- Custom migration: row-level security and grants for the code worktrees table (S7-5). Same rule as 0001.

alter table "code_worktrees" enable row level security;
--> statement-breakpoint
alter table "code_worktrees" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "code_worktrees"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "code_worktrees" to conclave_app;
