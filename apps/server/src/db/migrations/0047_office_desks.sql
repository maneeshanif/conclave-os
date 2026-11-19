CREATE TABLE "office_desks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"room" text NOT NULL,
	"slot" integer,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_desks_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "office_desks_ws_agent_uq" UNIQUE("workspace_id","agent_id"),
	CONSTRAINT "office_desks_ws_room_slot_uq" UNIQUE("workspace_id","room","slot"),
	CONSTRAINT "office_desks_slot_ck" CHECK ("office_desks"."slot" is null or "office_desks"."slot" >= 1)
);
--> statement-breakpoint
ALTER TABLE "office_desks" ADD CONSTRAINT "office_desks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_desks" ADD CONSTRAINT "office_desks_agent_fk" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;