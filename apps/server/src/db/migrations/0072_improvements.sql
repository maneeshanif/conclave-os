CREATE TABLE "improvements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"approval_id" uuid,
	"skill" text NOT NULL,
	"why" text NOT NULL,
	"expected_gain" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" text NOT NULL,
	"eval_output" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "improvements_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "improvements_status_ck" CHECK ("improvements"."status" in ('proposed','eval_failed'))
);
--> statement-breakpoint
ALTER TABLE "improvements" ADD CONSTRAINT "improvements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;