CREATE TABLE "setup_steps" (
	"workspace_id" uuid NOT NULL,
	"step" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_steps_pkey" PRIMARY KEY("workspace_id","step")
);
--> statement-breakpoint
ALTER TABLE "setup_steps" ADD CONSTRAINT "setup_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;