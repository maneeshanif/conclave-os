import { withWorkspace } from '../db/tenant';
import { readSettings } from '../settings';
import type { ExecResult, ExecutorDeps } from './email';

/**
 * The executor that adds an agent (SPEC 5, 6, 7). Plain code, no model. A person proposes an agent from the office and approves it;
 * only then does this run the same logic as `pnpm agent:new`: a role file from a template, a registered agent, a working folder.
 * It claims the approval once (approved to executing) before it acts. The id was chosen when the proposal was made, and an agent
 * that already has that id is never overwritten: the approval then fails with that reason and a note for the person.
 */
interface Payload {
  department: string;
  template: string;
  name?: string;
  id: string;
}

export async function executeAgentCreate(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const claim = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if ((await readSettings(c, ws)).killSwitch) return { kind: 'kill_switch' as const };
    const r = await c.query<{ payload: Payload }>("update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'agent.create' returning payload", [approvalId]);
    return r.rows[0] ? { kind: 'claimed' as const, payload: r.rows[0].payload } : { kind: 'none' as const };
  });
  if (claim.kind === 'kill_switch') return { status: 'kill_switch' };
  if (claim.kind === 'none') return { status: 'already_claimed' };

  const finish = async (ok: boolean, result: Record<string, unknown>, item?: { title: string; body: string }) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, ok ? 'executed' : 'failed', JSON.stringify(result)]);
      if (item) await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', $2, $3, $4) on conflict do nothing", [ws, item.title, item.body, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:agent', $2, $3, $4)", [ws, ok ? 'approval.executed' : 'approval.failed', approvalId, JSON.stringify(result)]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status: ok ? 'executed' : 'failed' });
    if (ok) deps.bus?.publish({ kind: 'office.changed', workspaceId: ws });
  };

  const p = claim.payload;
  if (!deps.agentFactory) {
    const reason = 'this server cannot add agents (no agent maker is set up)';
    await finish(false, { reason }, { title: 'An agent could not be added', body: reason });
    return { status: 'refused', reason };
  }
  try {
    const made = await deps.agentFactory({ template: p.template, department: p.department, id: p.id, ...(p.name ? { name: p.name } : {}) });
    await finish(true, { agentId: made.id, department: p.department, template: p.template });
    return { status: 'executed', ref: `agent:${made.id}` };
  } catch (err) {
    const reason = (err as Error).message;
    await finish(false, { reason }, { title: `The agent "${p.name ?? p.id}" could not be added`, body: `${reason}\nNothing was changed for it. Propose it again if you still want it.` });
    return { status: 'failed', reason };
  }
}

/** On start: a proposal that was approved but not carried out is carried out now (once). One left executing is tried again; if the agent was in fact made, that fails harmlessly with "already exists". */
export async function recoverAgents(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
  const ws = deps.workspaceId;
  const ids = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    await c.query("update approvals set status = 'approved' where kind = 'agent.create' and status = 'executing'");
    return (await c.query<{ id: string }>("select id from approvals where kind = 'agent.create' and status = 'approved' order by decided_at, id")).rows.map((r) => r.id);
  });
  const resumed: string[] = [];
  for (const id of ids) if ((await executeAgentCreate(deps, id)).status === 'executed') resumed.push(id);
  return { resumed, unknown: [] };
}

export async function releaseAgents(deps: ExecutorDeps): Promise<string[]> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string }>("select id from approvals where kind = 'agent.create' and status = 'approved' order by decided_at, id"));
  const released: string[] = [];
  for (const { id } of ids.rows) if ((await executeAgentCreate(deps, id)).status === 'executed') released.push(id);
  return released;
}
