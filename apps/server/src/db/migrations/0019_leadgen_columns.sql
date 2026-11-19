ALTER TABLE "leads" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "verified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score" smallint;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "scored_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "leads_ws_domain_idx" ON "leads" USING btree ("workspace_id","domain");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_score_ck" CHECK ("leads"."score" is null or "leads"."score" between 0 and 100);--> statement-breakpoint
UPDATE "leads" SET "domain" = lower(regexp_replace(regexp_replace("website", '^[a-z][a-z0-9+.-]*://', '', 'i'), '^www\.|[/:?#].*$', '', 'ig')) WHERE "website" IS NOT NULL AND "domain" IS NULL;
