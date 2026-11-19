CREATE TABLE "catalog_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"key" text NOT NULL,
	"division" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"text" text NOT NULL,
	"hash" text NOT NULL,
	"pinned_id" text NOT NULL,
	"license" text NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dropped_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_roles_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "catalog_roles_ws_source_key_uq" UNIQUE("workspace_id","source","key")
);
--> statement-breakpoint
ALTER TABLE "catalog_roles" ADD CONSTRAINT "catalog_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;