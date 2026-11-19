-- Custom migration: row-level security and grants for video ideas. Same rule as 0001.

alter table "video_ideas" enable row level security;
--> statement-breakpoint
alter table "video_ideas" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "video_ideas"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "video_ideas" to conclave_app;
