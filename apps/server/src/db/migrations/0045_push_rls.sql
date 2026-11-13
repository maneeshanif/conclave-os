-- Custom migration: row-level security and grants for push subscriptions. Same rule as 0001.

alter table "push_subscriptions" enable row level security;
--> statement-breakpoint
alter table "push_subscriptions" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "push_subscriptions"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "push_subscriptions" to conclave_app;

--> statement-breakpoint

alter table "push_events" enable row level security;
--> statement-breakpoint
alter table "push_events" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "push_events"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "push_events" to conclave_app;
