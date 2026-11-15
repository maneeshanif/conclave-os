CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"discussion_id" uuid,
	"title" text NOT NULL,
	"decision" text NOT NULL,
	"owner" text,
	"due" date,
	"decided_by" text DEFAULT 'founder' NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "discussion_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"discussion_id" uuid NOT NULL,
	"speaker" text NOT NULL,
	"round" smallint NOT NULL,
	"body" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disagreements" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discussion_turns_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "discussion_turns_once_uq" UNIQUE("workspace_id","discussion_id","speaker","round"),
	CONSTRAINT "discussion_turns_round_ck" CHECK ("discussion_turns"."round" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "discussions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"question" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by" text NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "discussions_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "discussions_kind_ck" CHECK ("discussions"."kind" in ('standup', 'weekly', 'adhoc')),
	CONSTRAINT "discussions_status_ck" CHECK ("discussions"."status" in ('open', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_discussion_fk" FOREIGN KEY ("workspace_id","discussion_id") REFERENCES "public"."discussions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_turns" ADD CONSTRAINT "discussion_turns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_turns" ADD CONSTRAINT "discussion_turns_discussion_fk" FOREIGN KEY ("workspace_id","discussion_id") REFERENCES "public"."discussions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussions" ADD CONSTRAINT "discussions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;