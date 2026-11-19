CREATE TABLE "code_worktrees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "code_worktrees_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "code_worktrees_ws_task_uq" UNIQUE("workspace_id","task_id"),
	CONSTRAINT "code_worktrees_status_ck" CHECK ("code_worktrees"."status" in ('open','closed'))
);
--> statement-breakpoint
ALTER TABLE "code_worktrees" ADD CONSTRAINT "code_worktrees_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_worktrees" ADD CONSTRAINT "code_worktrees_task_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_worktrees" ADD CONSTRAINT "code_worktrees_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."code_projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;