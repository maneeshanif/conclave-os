ALTER TABLE "video_briefs" DROP CONSTRAINT "video_briefs_status_ck";--> statement-breakpoint
ALTER TABLE "video_briefs" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "video_briefs" ADD COLUMN "plan_hash" text;--> statement-breakpoint
ALTER TABLE "video_briefs" ADD COLUMN "review" jsonb;--> statement-breakpoint
ALTER TABLE "video_briefs" ADD CONSTRAINT "video_briefs_status_ck" CHECK ("video_briefs"."status" in ('pending_approval','approved','rejected','expired','generating','generated','ready','review_failed','failed','cancelled'));