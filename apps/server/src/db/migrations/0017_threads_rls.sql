-- Custom migration: row-level security and grants for enrollments, threads and thread messages. Same rule as 0001.

alter table "sequence_enrollments" enable row level security;
--> statement-breakpoint
alter table "sequence_enrollments" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "sequence_enrollments"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "sequence_enrollments" to conclave_app;
--> statement-breakpoint

alter table "threads" enable row level security;
--> statement-breakpoint
alter table "threads" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "threads"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "threads" to conclave_app;
--> statement-breakpoint

alter table "thread_messages" enable row level security;
--> statement-breakpoint
alter table "thread_messages" force row level security;
--> statement-breakpoint
create policy tenant_isolation on "thread_messages"
  using      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant select, insert, update, delete on "thread_messages" to conclave_app;
--> statement-breakpoint

