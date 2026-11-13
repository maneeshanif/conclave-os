CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"approval_id" uuid,
	"published_url" text,
	"published_at" timestamp with time zone,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "posts_platform_ck" CHECK ("posts"."platform" in ('x','linkedin','instagram')),
	CONSTRAINT "posts_status_ck" CHECK ("posts"."status" in ('proposed','approved','publishing','published','rejected','expired','failed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_account_fk" FOREIGN KEY ("workspace_id","channel_account_id") REFERENCES "public"."channel_accounts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_approval_fk" FOREIGN KEY ("workspace_id","approval_id") REFERENCES "public"."approvals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "posts_live_text_uq" ON "posts" USING btree ("workspace_id","channel_account_id","text_hash") WHERE "posts"."status" not in ('rejected','expired','cancelled');--> statement-breakpoint
CREATE INDEX "posts_ws_status_idx" ON "posts" USING btree ("workspace_id","status","created_at");