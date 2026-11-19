import type pg from 'pg';
import { withWorkspace } from '../db/tenant';

/**
 * The weekly scorecard (S8-7, SPEC 9): one row per active agent, counted from the tables, never from what an agent says about itself.
 * Checks passed are succeeded runs that needed no repair. Boundary attempts are tool calls the server refused (a tool the agent
 * was not given, or a refused proposal). "Accepted" counts approvals decided yes, whether or not the founder edited them first.
 */
export interface Scorecard {
  agentKey: string;
  name: string;
  department: string | null;
  tasksDone: number;
  runs: number;
  checksPassed: number;
  accepted: number;
  acceptedAsIs: number;
  edited: number;
  rejected: number;
  costUsd: number;
  costPerAccepted: number | null;
  boundaryAttempts: number;
  suggestion: { move: 'skill_patch' | 'different_persona' | 'bench'; why: string } | null;
}

/** The three moves a weak agent can get, first match wins. Pure, so the rule can be read and tested on its own. */
export function suggestFor(c: Pick<Scorecard, 'runs' | 'checksPassed' | 'accepted' | 'edited' | 'rejected' | 'boundaryAttempts'>): Scorecard['suggestion'] {
  if (c.boundaryAttempts >= 3) return { move: 'bench', why: `it tried to cross a boundary ${c.boundaryAttempts} times this week` };
  if (c.runs >= 3 && c.checksPassed * 2 < c.runs) return { move: 'different_persona', why: `only ${c.checksPassed} of ${c.runs} runs passed their checks` };
  const decided = c.accepted + c.rejected;
  if (decided >= 3 && (c.edited + c.rejected) * 2 > decided) return { move: 'skill_patch', why: `${c.edited} edited and ${c.rejected} rejected out of ${decided} decided` };
  return null;
}

export async function weeklyScorecards(pool: pg.Pool, workspaceId: string, o: { since: Date; until?: Date }): Promise<Scorecard[]> {
  const until = o.until ?? new Date();
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) =>
    c.query<{
      key: string;
      name: string;
      department: string | null;
      tasks_done: number;
      runs: number;
      checks_passed: number;
      accepted: number;
      accepted_as_is: number;
      edited: number;
      rejected: number;
      cost: string;
      boundary: number;
    }>(
      `select a.key, a.name, d.key as department,
         (select count(*)::int from tasks t where t.assignee_id = a.id and t.status = 'done' and t.done_at >= $1 and t.done_at < $2) as tasks_done,
         (select count(*)::int from runs r where r.agent_id = a.id and r.started_at >= $1 and r.started_at < $2) as runs,
         (select count(*)::int from runs r where r.agent_id = a.id and r.started_at >= $1 and r.started_at < $2 and r.status = 'succeeded'
             and not exists (select 1 from run_events e where e.run_id = r.id and e.type = 'repair')) as checks_passed,
         (select count(*)::int from approvals p where p.agent_id = a.id and p.decided_at >= $1 and p.decided_at < $2 and p.status in ('approved','executing','executed','failed')) as accepted,
         (select count(*)::int from approvals p where p.agent_id = a.id and p.decided_at >= $1 and p.decided_at < $2 and p.status in ('approved','executing','executed','failed') and p.edited_payload is null) as accepted_as_is,
         (select count(*)::int from approvals p where p.agent_id = a.id and p.decided_at >= $1 and p.decided_at < $2 and p.status in ('approved','executing','executed','failed') and p.edited_payload is not null) as edited,
         (select count(*)::int from approvals p where p.agent_id = a.id and p.decided_at >= $1 and p.decided_at < $2 and p.status = 'rejected') as rejected,
         (select coalesce(sum(r.cost_usd), 0) from runs r where r.agent_id = a.id and r.started_at >= $1 and r.started_at < $2) as cost,
         (select count(*)::int from run_events e join runs r on r.id = e.run_id and r.workspace_id = e.workspace_id
            where r.agent_id = a.id and e.at >= $1 and e.at < $2 and e.type = 'tool_result' and e.data->>'ok' = 'false' and e.data->>'summary' ~* '(unknown tool|refused)') as boundary
       from agents a join departments d on d.id = a.department_id and d.workspace_id = a.workspace_id
       where a.status = 'active'
       order by d.key, a.key`,
      [o.since, until],
    ),
  );
  return r.rows.map((x) => {
    const costUsd = Number(x.cost);
    const base = { agentKey: x.key, name: x.name, department: x.department, tasksDone: x.tasks_done, runs: x.runs, checksPassed: x.checks_passed, accepted: x.accepted, acceptedAsIs: x.accepted_as_is, edited: x.edited, rejected: x.rejected, costUsd, costPerAccepted: x.accepted ? Number((costUsd / x.accepted).toFixed(4)) : null, boundaryAttempts: x.boundary };
    return { ...base, suggestion: suggestFor(base) };
  });
}
