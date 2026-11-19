CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"department_id" uuid,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"author" text,
	"excerpt" text,
	"status" text DEFAULT 'new' NOT NULL,
	"score" smallint,
	"reason" text,
	"lead_id" uuid,
	"found_by" text NOT NULL,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "signals_ws_url_uq" UNIQUE("workspace_id","url"),
	CONSTRAINT "signals_kind_ck" CHECK ("signals"."kind" in ('service_request','pain_point','tool_news')),
	CONSTRAINT "signals_status_ck" CHECK ("signals"."status" in ('new','qualified','dismissed','promoted')),
	CONSTRAINT "signals_score_ck" CHECK ("signals"."score" is null or "signals"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_department_fk" FOREIGN KEY ("workspace_id","department_id") REFERENCES "public"."departments"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_lead_fk" FOREIGN KEY ("workspace_id","lead_id") REFERENCES "public"."leads"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signals_ws_status_idx" ON "signals" USING btree ("workspace_id","status","found_at");