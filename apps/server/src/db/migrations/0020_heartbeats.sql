ALTER TABLE "agents" ADD COLUMN "heartbeat_task" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_heartbeat_at" timestamp with time zone;