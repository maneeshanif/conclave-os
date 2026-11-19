CREATE TABLE "call_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"day" text NOT NULL,
	"opener" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_list_items_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "call_list_items_ws_lead_day_uq" UNIQUE("workspace_id","lead_id","day"),
	CONSTRAINT "call_list_items_status_ck" CHECK ("call_list_items"."status" in ('queued','called','booked','skipped'))
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "call_list_items" ADD CONSTRAINT "call_list_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_list_items" ADD CONSTRAINT "call_list_items_lead_fk" FOREIGN KEY ("workspace_id","lead_id") REFERENCES "public"."leads"("workspace_id","id") ON DELETE no action ON UPDATE no action;