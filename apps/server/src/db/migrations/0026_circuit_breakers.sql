CREATE TABLE "circuit_breakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"state" text DEFAULT 'closed' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"opened_at" timestamp with time zone,
	"open_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circuit_breakers_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "circuit_breakers_ws_key_uq" UNIQUE("workspace_id","key"),
	CONSTRAINT "circuit_breakers_state_ck" CHECK ("circuit_breakers"."state" in ('closed','open'))
);
--> statement-breakpoint
ALTER TABLE "circuit_breakers" ADD CONSTRAINT "circuit_breakers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;