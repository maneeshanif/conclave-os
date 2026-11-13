ALTER TABLE "channel_accounts" ADD COLUMN "transport" text DEFAULT 'outbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "browser_profile" text;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "session_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "session_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_transport_ck" CHECK ("channel_accounts"."transport" in ('outbox','browser'));--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_session_ck" CHECK ("channel_accounts"."session_state" in ('none','valid','expired'));