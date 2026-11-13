-- Custom migration: row-level security and grants for funnels, stage events and projects. Same rule as 0001.

alter table "funnels" enable row level security;
--> statement-breakpoint
alter table "funnels" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "funnels"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "funnels" to conclave_app;
--> statement-breakpoint

alter table "funnel_stages" enable row level security;
--> statement-breakpoint
alter table "funnel_stages" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "funnel_stages"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "funnel_stages" to conclave_app;
--> statement-breakpoint

alter table "deal_stage_events" enable row level security;
--> statement-breakpoint
alter table "deal_stage_events" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "deal_stage_events"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "deal_stage_events" to conclave_app;
--> statement-breakpoint

alter table "projects" enable row level security;
--> statement-breakpoint
alter table "projects" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "projects"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "projects" to conclave_app;
--> statement-breakpoint

grant usage, select on sequence "deal_stage_events_id_seq" to conclave_app;
