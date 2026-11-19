CREATE TABLE "hooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"format" text,
	"platform" text,
	"example_url" text NOT NULL,
	"notes" text,
	"score" smallint,
	"found_by" text NOT NULL,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hooks_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "hooks_ws_example_uq" UNIQUE("workspace_id","example_url"),
	CONSTRAINT "hooks_score_ck" CHECK ("hooks"."score" is null or "hooks"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "hooks" ADD CONSTRAINT "hooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;