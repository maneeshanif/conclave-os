-- Custom migration: row-level security and grants for the channel_messages table (S10-6). Same rule as 0001.

alter table "channel_messages" enable row level security;
--> statement-breakpoint
alter table "channel_messages" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "channel_messages"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "channel_messages" to conclave_app;
