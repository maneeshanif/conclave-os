-- Custom migration: row-level security and grants for the Boardroom tables. Same rule as 0001.

alter table "discussions" enable row level security;
--> statement-breakpoint
alter table "discussions" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "discussions"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "discussions" to conclave_app;
--> statement-breakpoint

alter table "discussion_turns" enable row level security;
--> statement-breakpoint
alter table "discussion_turns" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "discussion_turns"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "discussion_turns" to conclave_app;
--> statement-breakpoint

alter table "decisions" enable row level security;
--> statement-breakpoint
alter table "decisions" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "decisions"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "decisions" to conclave_app;
