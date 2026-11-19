CREATE TABLE "sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"steps_sent" smallint DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequence_enrollments_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "sequence_enrollments_campaign_lead_uq" UNIQUE("workspace_id","campaign_id","lead_id"),
	CONSTRAINT "sequence_enrollments_status_ck" CHECK ("sequence_enrollments"."status" in ('active','paused','done','unsubscribed'))
);
--> statement-breakpoint
CREATE TABLE "thread_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"campaign_id" uuid,
	"classification" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_messages_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "thread_messages_direction_ck" CHECK ("thread_messages"."direction" in ('in','out')),
	CONSTRAINT "thread_messages_class_ck" CHECK ("thread_messages"."classification" is null or "thread_messages"."classification" in ('positive','neutral','negative'))
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid,
	"contact_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "threads_who_ck" CHECK ("threads"."lead_id" is not null or "threads"."contact_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_lead_fk" FOREIGN KEY ("workspace_id","lead_id") REFERENCES "public"."leads"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_fk" FOREIGN KEY ("workspace_id","thread_id") REFERENCES "public"."threads"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_lead_fk" FOREIGN KEY ("workspace_id","lead_id") REFERENCES "public"."leads"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sequence_enrollments_lead_idx" ON "sequence_enrollments" USING btree ("workspace_id","lead_id");--> statement-breakpoint
CREATE INDEX "thread_messages_thread_idx" ON "thread_messages" USING btree ("workspace_id","thread_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_ws_lead_uq" ON "threads" USING btree ("workspace_id","lead_id") WHERE "threads"."lead_id" is not null;