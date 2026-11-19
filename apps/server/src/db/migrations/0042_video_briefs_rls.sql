-- Custom migration: row-level security and grants for video briefs. Same rule as 0001.

alter table "video_briefs" enable row level security;
--> statement-breakpoint
alter table "video_briefs" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "video_briefs"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "video_briefs" to conclave_app;

--> statement-breakpoint

alter table "video_assets" enable row level security;
--> statement-breakpoint
alter table "video_assets" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "video_assets"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "video_assets" to conclave_app;
