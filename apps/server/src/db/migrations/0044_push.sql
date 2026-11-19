CREATE TABLE "push_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_events_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "push_events_ws_kind_ref_uq" UNIQUE("workspace_id","kind","ref"),
	CONSTRAINT "push_events_kind_ck" CHECK ("push_events"."kind" in ('approval_waiting','executor_failed','brief'))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_ok_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "push_subscriptions_ws_endpoint_uq" UNIQUE("workspace_id","endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_events" ADD CONSTRAINT "push_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;