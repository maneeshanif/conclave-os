CREATE TABLE "channel_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"from_name" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_messages_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "channel_messages_ws_channel_ext_uq" UNIQUE("workspace_id","channel","external_id"),
	CONSTRAINT "channel_messages_channel_ck" CHECK ("channel_messages"."channel" in ('slack','jira','helpdesk')),
	CONSTRAINT "channel_messages_status_ck" CHECK ("channel_messages"."status" in ('new','replied'))
);
--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;