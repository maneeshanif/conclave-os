ALTER TABLE "deals" ADD COLUMN "metric" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "baseline_value" numeric;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "target_value" numeric;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "outcome_value" numeric;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_figures_ck" CHECK (("deals"."baseline_value" is null or "deals"."baseline_value" >= 0) and ("deals"."target_value" is null or "deals"."target_value" >= 0) and ("deals"."outcome_value" is null or "deals"."outcome_value" >= 0));