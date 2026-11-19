import { withWorkspace } from '../db/tenant';
import { DeployError } from '../projects/deployer';
import { readSettings } from '../settings';
import type { ExecResult, ExecutorDeps } from './email';

/**
 * The `deploy` executor (S7-8, SPEC 6). Plain code, no model. It claims the approval once, records a deployment row, and asks the deployer
 * to build and serve the project's base branch. A failed build is recorded as failed, with why, and nothing is served. Never retried:
 * after a restart, one left `executing` is marked failed.
 */
interface Payload {
  projectKey: string;
  client?: string | null;
}

export async function executeDeploy(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const claim = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if ((await readSettings(c, ws)).killSwitch) return { kind: 'kill_switch' as const };
    const r = await c.query<{ payload: Payload; decided_by: string | null }>("update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'deploy' returning payload, decided_by", [approvalId]);
    return r.rows[0] ? { kind: 'claimed' as const, payload: r.rows[0].payload, by: r.rows[0].decided_by ?? 'founder' } : { kind: 'none' as const };
  });
  if (claim.kind === 'kill_switch') return { status: 'kill_switch' };
  if (claim.kind === 'none') return { status: 'already_claimed' };
  const p = claim.payload;

  const dep = await withWorkspace(deps.pool, ws, async ({ client: c }) =>
    (
      await c.query<{ id: string }>("insert into deployments (workspace_id, approval_id, project_key, client, status, approved_by) values ($1, $2, $3, $4, 'building', $5) returning id", [ws, approvalId, p.projectKey, p.client ?? null, claim.by])
    ).rows[0]!,
  );
  const finish = async (ok: boolean, d: { ref?: string; url?: string; reason?: string }) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query("update deployments set status = $2, ref = $3, url = $4, error = $5, finished_at = now() where id = $1", [dep.id, ok ? 'live' : 'failed', d.ref ?? null, d.url ?? null, d.reason ?? null]);
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, ok ? 'executed' : 'failed', JSON.stringify(d)]);
      if (!ok) await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', $2, $3, $4) on conflict do nothing", [ws, `The deploy of ${p.projectKey} failed`, `${d.reason}\nNothing is being served. Fix it and ask for a new deploy.`, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:deploy', $2, $3, $4)", [ws, ok ? 'approval.executed' : 'approval.failed', approvalId, JSON.stringify(d)]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status: ok ? 'executed' : 'failed' });
  };
  if (!deps.deployer) {
    const reason = 'this server has no deployer set up';
    await finish(false, { reason });
    return { status: 'refused', reason };
  }
  const project = await withWorkspace(deps.pool, ws, async ({ client: c }) => (await c.query<{ default_branch: string; build_cmd: string | null }>('select default_branch, build_cmd from code_projects where key = $1', [p.projectKey])).rows[0]);
  if (!project) {
    const reason = `the project "${p.projectKey}" is no longer registered`;
    await finish(false, { reason });
    return { status: 'refused', reason };
  }
  try {
    const out = await deps.deployer.deploy({ id: dep.id, projectKey: p.projectKey, base: project.default_branch, buildCmd: project.build_cmd });
    await finish(true, out);
    return { status: 'executed', ref: `deploy:${out.url}` };
  } catch (err) {
    const reason = err instanceof DeployError ? err.message : (err as Error).message;
    await finish(false, { reason });
    return { status: 'failed', reason };
  }
}

/** On start: approved deploys that never ran are run; one left `executing` is failed (its server did not survive the restart), never run again. */
export async function recoverDeploys(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    approved: (await c.query<{ id: string }>("select id from approvals where kind = 'deploy' and status = 'approved' order by decided_at, id")).rows.map((r) => r.id),
    executing: (await c.query<{ id: string }>("select id from approvals where kind = 'deploy' and status = 'executing'")).rows.map((r) => r.id),
  }));
  for (const id of executing) {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query("update deployments set status = 'failed', error = 'interrupted by a restart', finished_at = now() where approval_id = $1 and status = 'building'", [id]);
      await c.query("update approvals set status = 'failed', result = $2 where id = $1 and status = 'executing'", [id, JSON.stringify({ reason: 'interrupted by a restart' })]);
    });
  }
  const resumed: string[] = [];
  for (const id of approved) if ((await executeDeploy(deps, id)).status === 'executed') resumed.push(id);
  return { resumed, unknown: executing };
}

export async function releaseDeploys(deps: ExecutorDeps): Promise<string[]> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string }>("select id from approvals where kind = 'deploy' and status = 'approved' order by decided_at, id"));
  const released: string[] = [];
  for (const { id } of ids.rows) if ((await executeDeploy(deps, id)).status === 'executed') released.push(id);
  return released;
}
