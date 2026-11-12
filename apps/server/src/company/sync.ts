import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import type { Company } from './loader';

export interface SyncResult {
  departments: number;
  goals: number;
  agents: number;
  retired: string[];
}

/**
 * Copies the company folder into the database by `key` (SPEC 5: the role file is the source of
 * truth for its front matter). Status and spend live only in the database and are kept.
 */
export async function syncCompany(pool: pg.Pool, workspaceId: string, company: Company): Promise<SyncResult> {
  return withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const deptIds = new Map<string, string>();
    for (const d of company.departments) {
      const r = await c.query<{ id: string }>(
        `insert into departments (workspace_id, key, name, room) values ($1, $2, $3, $4)
         on conflict (workspace_id, key) do update set name = excluded.name, room = excluded.room
         returning id`,
        [workspaceId, d.key, d.name, JSON.stringify({ number: d.room, active: d.active, division: d.division ?? null })],
      );
      deptIds.set(d.key, r.rows[0]!.id);
    }

    const rungIds = new Map<string, string>();
    for (const rung of company.goals.ladder) {
      const due = rung.by ? new Date(rung.by).toISOString().slice(0, 10) : null;
      const r = await c.query<{ id: string }>(
        `insert into goals (workspace_id, key, kind, title, metric, target, source, due, status)
         values ($1, $2, 'rung', $3, 'monthly_revenue_usd', $4, $5, $6, $7)
         on conflict (workspace_id, key) do update set title = excluded.title, target = excluded.target,
           source = excluded.source, due = excluded.due, status = excluded.status
         returning id`,
        [workspaceId, rung.id, `$${rung.target_usd} a month`, rung.target_usd, rung.source ?? null, due,
          rung.id === company.goals.current_rung ? 'active' : 'planned'],
      );
      rungIds.set(rung.id, r.rows[0]!.id);
    }
    let deptGoals = 0;
    for (const [dept, g] of Object.entries(company.goals.department_goals)) {
      await c.query(
        `insert into goals (workspace_id, key, kind, parent_id, department_id, title, metric)
         values ($1, $2, 'department', $3, $4, $5, $6)
         on conflict (workspace_id, key) do update set parent_id = excluded.parent_id,
           department_id = excluded.department_id, title = excluded.title, metric = excluded.metric`,
        [workspaceId, `${dept}:${g.metric}`, rungIds.get(g.serves), deptIds.get(dept), `${dept}: ${g.metric}`, g.metric],
      );
      deptGoals++;
    }

    const agentIds = new Map<string, string>();
    for (const a of company.agents) {
      const r = a.role;
      let templateId: string | null = null;
      if (r.template) {
        const t = await c.query<{ id: string }>(
          `insert into agent_templates (workspace_id, key, version, path) values ($1, $2, $3, $4)
           on conflict (workspace_id, key) do update set version = greatest(agent_templates.version, excluded.version)
           returning id`,
          [workspaceId, r.template, r.template_version ?? 1, `templates/agents/${r.template}`],
        );
        templateId = t.rows[0]!.id;
      }
      const row = await c.query<{ id: string }>(
        `insert into agents (workspace_id, key, name, department_id, template_id, template_version, runtime, model_alias,
           fallback_alias, heartbeat_cron, autonomy, max_turns, output_check, monthly_budget_usd, status, role_path)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15)
         on conflict (workspace_id, key) do update set name = excluded.name, department_id = excluded.department_id,
           template_id = excluded.template_id, template_version = excluded.template_version, runtime = excluded.runtime,
           model_alias = excluded.model_alias, fallback_alias = excluded.fallback_alias, heartbeat_cron = excluded.heartbeat_cron,
           autonomy = excluded.autonomy, max_turns = excluded.max_turns, output_check = excluded.output_check,
           monthly_budget_usd = excluded.monthly_budget_usd, role_path = excluded.role_path,
           status = case when agents.status = 'retired' then 'active' else agents.status end
         returning id`,
        [workspaceId, r.id, r.name, deptIds.get(r.department), templateId, r.template_version ?? null, r.runtime, r.model,
          r.fallback_model ?? null, r.heartbeat ?? null, r.autonomy, r.max_turns, r.output_check ?? null, r.monthly_budget_usd, a.rolePath],
      );
      agentIds.set(r.id, row.rows[0]!.id);
    }
    for (const a of company.agents) {
      await c.query('update agents set reports_to = $1 where id = $2', [a.role.reports_to ? agentIds.get(a.role.reports_to) : null, agentIds.get(a.role.id)]);
    }
    const retired = await c.query<{ key: string }>(
      "update agents set status = 'retired' where status <> 'retired' and not (key = any($1::text[])) returning key",
      [[...agentIds.keys()]],
    );

    return {
      departments: deptIds.size,
      goals: rungIds.size + deptGoals,
      agents: agentIds.size,
      retired: retired.rows.map((x) => x.key),
    };
  });
}
