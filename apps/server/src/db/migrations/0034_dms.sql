CREATE TABLE "dms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"approval_id" uuid,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dms_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "dms_channel_ck" CHECK ("dms"."channel" in ('x_dm','ig_dm')),
	CONSTRAINT "dms_status_ck" CHECK ("dms"."status" in ('proposed','approved','sending','sent','rejected','expired','failed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "dms" ADD CONSTRAINT "dms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms" ADD CONSTRAINT "dms_account_fk" FOREIGN KEY ("workspace_id","channel_account_id") REFERENCES "public"."channel_accounts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms" ADD CONSTRAINT "dms_lead_fk" FOREIGN KEY ("workspace_id","lead_id") REFERENCES "public"."leads"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms" ADD CONSTRAINT "dms_approval_fk" FOREIGN KEY ("workspace_id","approval_id") REFERENCES "public"."approvals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dms_live_uq" ON "dms" USING btree ("workspace_id","channel_account_id","recipient","text_hash") WHERE "dms"."status" not in ('rejected','expired','cancelled');--> statement-breakpoint
CREATE INDEX "dms_account_sent_idx" ON "dms" USING btree ("workspace_id","channel_account_id","status","sent_at");