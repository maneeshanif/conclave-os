ALTER TABLE "workspace_settings" ALTER COLUMN "email_daily_cap" SET DEFAULT 100;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "window_hours" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "window_cap" integer DEFAULT 30 NOT NULL;