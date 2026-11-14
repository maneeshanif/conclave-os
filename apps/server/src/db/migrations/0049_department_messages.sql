CREATE TABLE "department_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_messages_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "department_messages" ADD CONSTRAINT "department_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_messages" ADD CONSTRAINT "department_messages_department_fk" FOREIGN KEY ("workspace_id","department_id") REFERENCES "public"."departments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;