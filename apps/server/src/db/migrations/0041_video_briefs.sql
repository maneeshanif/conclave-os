CREATE TABLE "video_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brief_id" uuid NOT NULL,
	"shot" integer NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"mime" text NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_assets_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "video_assets_brief_shot_uq" UNIQUE("workspace_id","brief_id","shot")
);
--> statement-breakpoint
CREATE TABLE "video_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"idea_id" uuid NOT NULL,
	"title" text NOT NULL,
	"script" text NOT NULL,
	"shots" jsonb NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"estimated_credits" integer NOT NULL,
	"spent_credits" integer DEFAULT 0 NOT NULL,
	"approval_id" uuid,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_briefs_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "video_briefs_status_ck" CHECK ("video_briefs"."status" in ('pending_approval','approved','rejected','expired','generating','generated','failed','cancelled')),
	CONSTRAINT "video_briefs_credits_ck" CHECK ("video_briefs"."estimated_credits" >= 0 and "video_briefs"."spent_credits" >= 0)
);
--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_brief_fk" FOREIGN KEY ("workspace_id","brief_id") REFERENCES "public"."video_briefs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_briefs" ADD CONSTRAINT "video_briefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_briefs" ADD CONSTRAINT "video_briefs_idea_fk" FOREIGN KEY ("workspace_id","idea_id") REFERENCES "public"."video_ideas"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_briefs" ADD CONSTRAINT "video_briefs_approval_fk" FOREIGN KEY ("workspace_id","approval_id") REFERENCES "public"."approvals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_briefs_live_idea_uq" ON "video_briefs" USING btree ("workspace_id","idea_id") WHERE "video_briefs"."status" not in ('rejected','expired','cancelled','failed');