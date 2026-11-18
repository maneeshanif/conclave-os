CREATE TABLE "bakeoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"department" text NOT NULL,
	"query" text NOT NULL,
	"template" text NOT NULL,
	"trial_task" text NOT NULL,
	"status" text DEFAULT 'scored' NOT NULL,
	"candidates" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bakeoffs_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "bakeoffs_status_ck" CHECK ("bakeoffs"."status" in ('scored','proposed'))
);
--> statement-breakpoint
ALTER TABLE "bakeoffs" ADD CONSTRAINT "bakeoffs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;