CREATE TABLE "code_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"path" text NOT NULL,
	"default_branch" text NOT NULL,
	"test_cmd" text,
	"build_cmd" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_projects_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "code_projects_ws_key_uq" UNIQUE("workspace_id","key"),
	CONSTRAINT "code_projects_ws_path_uq" UNIQUE("workspace_id","path")
);
--> statement-breakpoint
ALTER TABLE "code_projects" ADD CONSTRAINT "code_projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;