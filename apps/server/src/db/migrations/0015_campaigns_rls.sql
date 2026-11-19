-- Custom migration: row-level security and grants for channel accounts, campaigns and sequence steps. Same rule as 0001.

alter table "channel_accounts" enable row level security;
--> statement-breakpoint
alter table "channel_accounts" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "channel_accounts"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "channel_accounts" to conclave_app;
--> statement-breakpoint

alter table "campaigns" enable row level security;
--> statement-breakpoint
alter table "campaigns" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "campaigns"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "campaigns" to conclave_app;
--> statement-breakpoint

alter table "sequence_steps" enable row level security;
--> statement-breakpoint
alter table "sequence_steps" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "sequence_steps"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "sequence_steps" to conclave_app;
--> statement-breakpoint

