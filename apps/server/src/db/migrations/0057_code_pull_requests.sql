CREATE TABLE "code_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"project_key" text NOT NULL,
	"number" integer NOT NULL,
	"task_id" uuid,
	"branch" text NOT NULL,
	"base" text NOT NULL,
	"head" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"connector" text NOT NULL,
	"url" text,
	"approved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_at" timestamp with time zone,
	CONSTRAINT "code_pull_requests_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "code_pull_requests_ws_approval_uq" UNIQUE("workspace_id","approval_id"),
	CONSTRAINT "code_pull_requests_ws_project_number_uq" UNIQUE("workspace_id","project_key","number"),
	CONSTRAINT "code_pull_requests_status_ck" CHECK ("code_pull_requests"."status" in ('open','merged','closed'))
);
--> statement-breakpoint
ALTER TABLE "code_pull_requests" ADD CONSTRAINT "code_pull_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_pull_requests" ADD CONSTRAINT "code_pull_requests_approval_fk" FOREIGN KEY ("workspace_id","approval_id") REFERENCES "public"."approvals"("workspace_id","id") ON DELETE no action ON UPDATE no action;