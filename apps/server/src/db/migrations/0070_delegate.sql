CREATE TABLE "delegate_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"delegate_id" uuid,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"reasoning" text DEFAULT '' NOT NULL,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegate_ledger_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "delegate_ledger_outcome_ck" CHECK ("delegate_ledger"."outcome" in ('cleared','refused'))
);
--> statement-breakpoint
CREATE TABLE "delegates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"public_key_pem" text NOT NULL,
	"fingerprint" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"mandate" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegates_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "delegate_ledger" ADD CONSTRAINT "delegate_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegate_ledger" ADD CONSTRAINT "delegate_ledger_approval_fk" FOREIGN KEY ("workspace_id","approval_id") REFERENCES "public"."approvals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegates" ADD CONSTRAINT "delegates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;