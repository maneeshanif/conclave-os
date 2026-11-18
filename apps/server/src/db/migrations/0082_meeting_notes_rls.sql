-- Custom migration: row-level security and grants for the meeting people and notes tables (S10-4). Same rule as 0001.

alter table "meeting_people" enable row level security;
--> statement-breakpoint
alter table "meeting_people" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "meeting_people"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "meeting_people" to conclave_app;
--> statement-breakpoint
alter table "meeting_notes" enable row level security;
--> statement-breakpoint
alter table "meeting_notes" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "meeting_notes"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "meeting_notes" to conclave_app;
