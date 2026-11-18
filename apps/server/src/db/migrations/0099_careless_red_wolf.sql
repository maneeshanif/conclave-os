ALTER TABLE "agent_probes" DROP CONSTRAINT "agent_probes_agent_fk";
--> statement-breakpoint
ALTER TABLE "agent_probes" ADD CONSTRAINT "agent_probes_agent_fk" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;