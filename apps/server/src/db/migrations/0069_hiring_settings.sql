ALTER TABLE "workspace_settings" ADD COLUMN "hiring_level" text DEFAULT 'H0' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "roster_cap" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "trial_budget_cap_usd" numeric(10, 2) DEFAULT '5' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_hiring_ck" CHECK ("workspace_settings"."hiring_level" in ('H0','H1') and "workspace_settings"."roster_cap" between 1 and 500);