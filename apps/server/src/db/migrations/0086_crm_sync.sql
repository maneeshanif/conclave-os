CREATE TABLE "crm_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"field" text NOT NULL,
	"local_value" text NOT NULL,
	"external_value" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_conflicts_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "crm_conflicts_ws_account_field_value_uq" UNIQUE("workspace_id","account_id","field","external_value"),
	CONSTRAINT "crm_conflicts_status_ck" CHECK ("crm_conflicts"."status" in ('open','resolved'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "crm_conflicts" ADD CONSTRAINT "crm_conflicts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conflicts" ADD CONSTRAINT "crm_conflicts_account_fk" FOREIGN KEY ("workspace_id","account_id") REFERENCES "public"."accounts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_ws_external_ref_uq" ON "accounts" USING btree ("workspace_id","external_ref") WHERE "accounts"."external_ref" is not null;