CREATE TABLE "video_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"idea" text NOT NULL,
	"kind" text DEFAULT 'line' NOT NULL,
	"url" text,
	"hook_id" uuid,
	"stage" text DEFAULT 'idea' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_ideas_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "video_ideas_source_ck" CHECK ("video_ideas"."source" in ('founder','hook_scout')),
	CONSTRAINT "video_ideas_kind_ck" CHECK ("video_ideas"."kind" in ('line','link','voice')),
	CONSTRAINT "video_ideas_stage_ck" CHECK ("video_ideas"."stage" in ('idea','shelved','brief','assets','render','review','published'))
);
--> statement-breakpoint
ALTER TABLE "video_ideas" ADD CONSTRAINT "video_ideas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_ideas" ADD CONSTRAINT "video_ideas_hook_fk" FOREIGN KEY ("workspace_id","hook_id") REFERENCES "public"."hooks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_ideas_ws_stage_idx" ON "video_ideas" USING btree ("workspace_id","stage","created_at");