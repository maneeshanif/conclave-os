CREATE TABLE "network_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_drafts_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "network_drafts_status_ck" CHECK ("network_drafts"."status" in ('draft','sent_by_you','discarded'))
);
--> statement-breakpoint
CREATE TABLE "network_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"where_found" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"last_touch" timestamp with time zone,
	"next_nudge" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_people_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "network_people_ws_key_uq" UNIQUE("workspace_id","name_key"),
	CONSTRAINT "network_people_status_ck" CHECK ("network_people"."status" in ('new','in_touch','dropped'))
);
--> statement-breakpoint
ALTER TABLE "network_drafts" ADD CONSTRAINT "network_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_drafts" ADD CONSTRAINT "network_drafts_person_fk" FOREIGN KEY ("workspace_id","person_id") REFERENCES "public"."network_people"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_people" ADD CONSTRAINT "network_people_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;