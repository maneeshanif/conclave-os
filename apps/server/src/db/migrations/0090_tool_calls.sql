CREATE TABLE "tool_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid,
	"agent_id" uuid,
	"tool" text NOT NULL,
	"risk" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_calls_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "tool_calls_decision_ck" CHECK ("tool_calls"."decision" in ('allowed','refused'))
);
--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_calls_ws_at_idx" ON "tool_calls" USING btree ("workspace_id","at");