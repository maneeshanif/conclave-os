CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"market" text,
	"channel" text DEFAULT 'email' NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel_account_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "campaigns_status_ck" CHECK ("campaigns"."status" in ('draft','approved','running','paused','done'))
);
--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"handle" text NOT NULL,
	"daily_cap" integer DEFAULT 10 NOT NULL,
	"warmup_until" date,
	"warmup_cap" integer DEFAULT 5 NOT NULL,
	"health" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_accounts_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "channel_accounts_caps_ck" CHECK ("channel_accounts"."daily_cap" between 1 and 1000 and "channel_accounts"."warmup_cap" between 1 and 1000),
	CONSTRAINT "channel_accounts_health_ck" CHECK ("channel_accounts"."health" in ('ok','paused','blocked'))
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"step" smallint NOT NULL,
	"wait_days" smallint DEFAULT 0 NOT NULL,
	"skill" text,
	"template" text,
	CONSTRAINT "sequence_steps_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "sequence_steps_campaign_step_uq" UNIQUE("workspace_id","campaign_id","step")
);
--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "channel_account_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_channel_fk" FOREIGN KEY ("workspace_id","channel_account_id") REFERENCES "public"."channel_accounts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_accounts_handle_uq" ON "channel_accounts" USING btree ("workspace_id","channel",lower("handle"));--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_channel_fk" FOREIGN KEY ("workspace_id","channel_account_id") REFERENCES "public"."channel_accounts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_channel_sent_idx" ON "outreach_messages" USING btree ("workspace_id","channel_account_id","sent_at");