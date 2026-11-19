-- Custom migration: the identity schema (S1-10) is reachable by the server's app role and by nobody else.
-- These are not tenant tables (a person signs in before any workspace is chosen), so there is no row-level security.
revoke all on schema auth from public;
--> statement-breakpoint
grant usage on schema auth to conclave_app;
--> statement-breakpoint
grant select, insert, update, delete on all tables in schema auth to conclave_app;
