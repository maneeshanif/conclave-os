CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"project_key" text NOT NULL,
	"client" text,
	"ref" text,
	"status" text DEFAULT 'building' NOT NULL,
	"url" text,
	"error" text,
	"approved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "deployments_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "deployments_ws_approval_uq" UNIQUE("workspace_id","approval_id"),
	CONSTRAINT "deployments_status_ck" CHECK ("deployments"."status" in ('building','live','failed'))
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_approval_fk" FOREIGN KEY ("workspace_id","approval_id") REFERENCES "public"."approvals"("workspace_id","id") ON DELETE no action ON UPDATE no action;