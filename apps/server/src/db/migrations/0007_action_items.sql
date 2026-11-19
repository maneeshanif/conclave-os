ALTER TABLE "action_items" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_task_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_items_approval_kind_uq" ON "action_items" USING btree ("workspace_id","approval_id","kind") WHERE "action_items"."approval_id" is not null;