import type pg from 'pg';
import { withWorkspace } from '../db/tenant';

/** The first moment of the month `now` is in, in this machine's time. */
export const monthStart = (now: Date) => new Date(now.getFullYear(), now.getMonth(), 1);
const monthKey = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

/**
 * The budget check before a run (SPEC 14, "Budget exhausted"). The ledger is the runs themselves: what an agent's runs
 * have cost this calendar month, compared with its monthly budget. At or over the budget the agent starts nothing and
 * no task is taken; one action item says so, once per agent per month. Nothing is killed mid-run: a run that crosses the
 * line finishes, and it is the next one that is refused. A budget of zero means nothing is allowed.
 */
export async function checkBudget(
  pool: pg.Pool,
  workspaceId: string,
  agent: { id: string; key: string; name: string; monthly_budget_usd: string | number },
  now: Date,
): Promise<{ over: boolean; spent: number; budget: number }> {
  const budget = Number(agent.monthly_budget_usd);
  return withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const r = await c.query<{ spent: string | null }>('select sum(cost_usd) as spent from runs where agent_id = $1 and started_at >= $2', [agent.id, monthStart(now)]);
    const spent = Number(r.rows[0]!.spent ?? 0);
    const over = spent >= budget;
    if (over) {
      const marker = `agent: ${agent.id}\nmonth: ${monthKey(now)}\n`;
      const have = await c.query("select 1 from action_items where kind = 'budget_exhausted' and body like $1", [`${marker}%`]);
      if (!have.rows.length) {
        await c.query("insert into action_items (workspace_id, kind, title, body) values ($1, 'budget_exhausted', $2, $3)", [
          workspaceId,
          `${agent.name} has used its budget for the month`,
          `${marker}${agent.name} (${agent.key}) has spent $${spent.toFixed(2)} of its $${budget.toFixed(2)} this month, so it starts no new runs. Raise monthly_budget_usd in its role file and reload the company (or wait for next month) to let it carry on. Its tasks stay queued.`,
        ]);
        await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'system', 'agent.over_budget', $2, $3)", [workspaceId, agent.id, JSON.stringify({ spent, budget })]);
      }
    }
    return { over, spent, budget };
  });
}

/**
 * Closes the budget items that no longer apply: the agent is back under budget (a raised budget) or the month has changed.
 * Says which agents have work waiting so the caller can wake them. Run by the ticker.
 */
export async function closeBudgetItems(o: { pool: pg.Pool; workspaceId: string; now?: () => Date }): Promise<{ closed: number; agentsWithWork: string[] }> {
  const now = (o.now ?? (() => new Date()))();
  return withWorkspace(o.pool, o.workspaceId, async ({ client: c }) => {
    const open = await c.query<{ id: string; body: string }>("select id, body from action_items where kind = 'budget_exhausted' and status = 'open'");
    let closed = 0;
    const wake: string[] = [];
    for (const it of open.rows) {
      const agentId = /^agent: (\S+)/.exec(it.body)?.[1];
      const month = /\nmonth: (\S+)/.exec(it.body)?.[1];
      if (!agentId) continue;
      const a = await c.query<{ monthly_budget_usd: string; spent: string | null }>(
        'select a.monthly_budget_usd, (select sum(cost_usd) from runs r where r.agent_id = a.id and r.started_at >= $2) as spent from agents a where a.id = $1',
        [agentId, monthStart(now)],
      );
      const row = a.rows[0];
      const stillOver = row && month === monthKey(now) && Number(row.spent ?? 0) >= Number(row.monthly_budget_usd);
      if (stillOver) continue;
      await c.query("update action_items set status = 'done', resolved_at = now(), resolved_by = 'system', resolution_note = 'The agent is back under its budget.' where id = $1", [it.id]);
      closed++;
      const work = await c.query("select 1 from tasks where assignee_id = $1 and status = 'todo' limit 1", [agentId]);
      if (work.rows.length) wake.push(agentId);
    }
    return { closed, agentsWithWork: wake };
  });
}
