CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"agent_id" uuid,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"confidence" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "memories_scope_ck" CHECK ("memories"."scope" in ('founder','company','market')),
	CONSTRAINT "memories_confidence_ck" CHECK ("memories"."confidence" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_agent_fk" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE no action ON UPDATE no action;