import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withWorkspace } from '../db/tenant';
import { readSettings } from '../settings';
import type { ExecResult, ExecutorDeps } from './email';

/**
 * The executors for `repo.create` and `pr.merge` (S7-7, SPEC 6). Plain code, no model. Each claims its approval once, acts through the git
 * connector, and records the result with the approver. Neither is ever retried: after a restart, one left `executing` is failed with a note.
 */
type Kind = 'repo.create' | 'pr.merge';

async function claim(deps: ExecutorDeps, approvalId: string, kind: Kind) {
  const ws = deps.workspaceId;
  return withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if ((await readSettings(c, ws)).killSwitch) return { kind: 'kill_switch' as const };
    const r = await c.query<{ payload: Record<string, unknown>; decided_by: string | null }>('update approvals set status = \'executing\' where id = $1 and status = \'approved\' and kind = $2 returning payload, decided_by', [approvalId, kind]);
    return r.rows[0] ? { kind: 'claimed' as const, payload: r.rows[0].payload, by: r.rows[0].decided_by ?? 'founder' } : { kind: 'none' as const };
  });
}

function finisher(deps: ExecutorDeps, approvalId: string, actor: string, what: string) {
  const ws = deps.workspaceId;
  return async (ok: boolean, result: Record<string, unknown>): Promise<void> => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, ok ? 'executed' : 'failed', JSON.stringify(result)]);
      if (!ok) await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', $2, $3, $4) on conflict do nothing", [ws, `${what} did not happen`, `${String(result.reason)}\nNothing was retried. Ask again if you still want it.`, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, $3, $4, $5)", [ws, actor, ok ? 'approval.executed' : 'approval.failed', approvalId, JSON.stringify(result)]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status: ok ? 'executed' : 'failed' });
  };
}

export async function executeRepoCreate(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const c = await claim(deps, approvalId, 'repo.create');
  if (c.kind === 'kill_switch') return { status: 'kill_switch' };
  if (c.kind === 'none') return { status: 'already_claimed' };
  const finish = finisher(deps, approvalId, 'executor:repo', 'A repository');
  const refuse = async (reason: string): Promise<ExecResult> => {
    await finish(false, { reason });
    return { status: 'refused', reason };
  };
  const p = c.payload as { key: string; description: string };
  if (!deps.gitConnector) return refuse('this server has no git connector set up');
  if (!deps.dataDir) return refuse('this server has no data folder for new projects');
  const taken = await withWorkspace(deps.pool, ws, async ({ client }) => (await client.query('select 1 from code_projects where key = $1', [p.key])).rows[0]);
  if (taken) return refuse(`the project "${p.key}" already exists`);
  const workPath = path.join(deps.dataDir, 'projects', p.key);
  try {
    await mkdir(path.dirname(workPath), { recursive: true });
    await deps.gitConnector.createRepo({ projectKey: p.key, workPath, description: p.description });
    await withWorkspace(deps.pool, ws, ({ client }) => client.query('insert into code_projects (workspace_id, key, path, default_branch) values ($1, $2, $3, $4)', [ws, p.key, workPath, 'main']));
    await finish(true, { key: p.key, path: workPath, connector: deps.gitConnector.name, approvedBy: c.by });
    return { status: 'executed', ref: `repo:${p.key}` };
  } catch (err) {
    const reason = (err as Error).message;
    await finish(false, { reason });
    return { status: 'failed', reason };
  }
}

export async function executeMerge(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const c = await claim(deps, approvalId, 'pr.merge');
  if (c.kind === 'kill_switch') return { status: 'kill_switch' };
  if (c.kind === 'none') return { status: 'already_claimed' };
  const finish = finisher(deps, approvalId, 'executor:merge', 'A merge');
  const refuse = async (reason: string): Promise<ExecResult> => {
    await finish(false, { reason });
    return { status: 'refused', reason };
  };
  const p = c.payload as { projectKey: string; number: number };
  if (!deps.gitConnector) return refuse('this server has no git connector set up');
  // Everything is checked again now, against the tables, not the proposal.
  const row = await withWorkspace(deps.pool, ws, async ({ client }) =>
    (
      await client.query<{ status: string; branch: string; base: string; title: string; path: string; tests_ok: string | null }>(
        `select r.status, r.branch, r.base, r.title, p.path, a.payload->'tests'->>'ok' as tests_ok
           from code_pull_requests r join code_projects p on p.key = r.project_key and p.workspace_id = r.workspace_id
           join approvals a on a.id = r.approval_id and a.workspace_id = r.workspace_id
          where r.project_key = $1 and r.number = $2`,
        [p.projectKey, p.number],
      )
    ).rows[0],
  );
  if (!row) return refuse(`there is no pull request #${p.number} on "${p.projectKey}"`);
  if (row.status !== 'open') return refuse(`the pull request is ${row.status}, not open`);
  if (row.tests_ok !== 'true') return refuse('the tests did not pass for this pull request');
  try {
    const out = await deps.gitConnector.merge({ projectKey: p.projectKey, projectPath: row.path, base: row.base, branch: row.branch, number: p.number, title: row.title });
    await withWorkspace(deps.pool, ws, ({ client }) => client.query("update code_pull_requests set status = 'merged', merged_at = now(), merged_by = $3 where project_key = $1 and number = $2", [p.projectKey, p.number, c.by]));
    await finish(true, { head: out.head, project: p.projectKey, number: p.number, approvedBy: c.by });
    return { status: 'executed', ref: `merge:${p.projectKey}#${p.number}` };
  } catch (err) {
    const reason = (err as Error).message;
    await finish(false, { reason });
    return { status: 'failed', reason };
  }
}

/** On start: approved ones that never ran are carried out; one left `executing` is never run again, and is failed with a note. */
export async function recoverRepo(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    approved: (await c.query<{ id: string; kind: Kind }>("select id, kind from approvals where kind in ('repo.create','pr.merge') and status = 'approved' order by decided_at, id")).rows,
    executing: (await c.query<{ id: string; kind: Kind }>("select id, kind from approvals where kind in ('repo.create','pr.merge') and status = 'executing'")).rows,
  }));
  const unknown: string[] = [];
  for (const a of executing) {
    await finisher(deps, a.id, 'executor:repo', a.kind === 'repo.create' ? 'A repository' : 'A merge')(false, { reason: 'interrupted; the outcome is unknown' });
    unknown.push(a.id);
  }
  const resumed: string[] = [];
  for (const a of approved) if ((await (a.kind === 'repo.create' ? executeRepoCreate : executeMerge)(deps, a.id)).status === 'executed') resumed.push(a.id);
  return { resumed, unknown };
}

export async function releaseRepo(deps: ExecutorDeps): Promise<string[]> {
  const rows = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string; kind: Kind }>("select id, kind from approvals where kind in ('repo.create','pr.merge') and status = 'approved' order by decided_at, id"));
  const released: string[] = [];
  for (const a of rows.rows) if ((await (a.kind === 'repo.create' ? executeRepoCreate : executeMerge)(deps, a.id)).status === 'executed') released.push(a.id);
  return released;
}
