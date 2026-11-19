import { withWorkspace } from '../db/tenant';
import { branchFacts } from '../projects/pr';
import { readSettings } from '../settings';
import type { ExecResult, ExecutorDeps } from './email';

/**
 * The `pr.open` executor (S7-6, SPEC 6). Plain code, no model. After a person approves a proposed pull request it claims the approval once
 * (approved to executing), checks the branch is still exactly the commit that was proposed, pushes it through the git connector and records
 * the pull request with the approver. A push is never retried: after a restart, one left `executing` is recorded if the remote has the
 * commit, and otherwise failed with a note.
 */
interface Payload {
  taskId: string;
  projectKey: string;
  branch: string;
  base: string;
  title: string;
  summary: string;
  head: string;
}

export async function executePrOpen(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const claim = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if ((await readSettings(c, ws)).killSwitch) return { kind: 'kill_switch' as const };
    const r = await c.query<{ payload: Payload; decided_by: string | null }>("update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'pr.open' returning payload, decided_by", [approvalId]);
    return r.rows[0] ? { kind: 'claimed' as const, payload: r.rows[0].payload, by: r.rows[0].decided_by ?? 'founder' } : { kind: 'none' as const };
  });
  if (claim.kind === 'kill_switch') return { status: 'kill_switch' };
  if (claim.kind === 'none') return { status: 'already_claimed' };
  const p = claim.payload;
  const connector = deps.gitConnector;

  const finish = async (ok: boolean, result: Record<string, unknown>, item?: { title: string; body: string }) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, ok ? 'executed' : 'failed', JSON.stringify(result)]);
      if (item) await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', $2, $3, $4) on conflict do nothing", [ws, item.title, item.body, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:pr', $2, $3, $4)", [ws, ok ? 'approval.executed' : 'approval.failed', approvalId, JSON.stringify(result)]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status: ok ? 'executed' : 'failed' });
  };
  const refuse = async (reason: string, status: 'refused' | 'failed' = 'refused'): Promise<ExecResult> => {
    await finish(false, { reason }, { title: 'A pull request was not opened', body: `${reason}\nNothing was pushed. Ask for the change again if you still want it.` });
    return { status, reason };
  };
  if (!connector) return refuse('this server has no git connector set up');

  const project = await withWorkspace(deps.pool, ws, async ({ client: c }) => (await c.query<{ path: string }>('select path from code_projects where key = $1', [p.projectKey])).rows[0]);
  if (!project) return refuse(`the project "${p.projectKey}" is no longer registered`);
  const wt = await withWorkspace(deps.pool, ws, async ({ client: c }) => (await c.query<{ path: string }>("select path from code_worktrees where task_id = $1 and status = 'open'", [p.taskId])).rows[0]);
  if (!wt) return refuse("the task's worktree is gone, so the proposed commit cannot be checked");
  try {
    const facts = await branchFacts(wt.path, p.base);
    if (facts.head !== p.head) return refuse(`the branch has changed since it was proposed (now ${facts.head.slice(0, 8)}, proposed ${p.head.slice(0, 8)}); propose it again`, 'failed');
  } catch (err) {
    return refuse((err as Error).message, 'failed');
  }
  try {
    await connector.push({ projectKey: p.projectKey, projectPath: project.path, branch: p.branch });
    const made = await record(deps, approvalId, p, claim.by);
    await finish(true, { number: made.number, branch: p.branch, head: p.head, connector: connector.name, url: made.url });
    return { status: 'executed', ref: `pr:${p.projectKey}#${made.number}` };
  } catch (err) {
    const reason = (err as Error).message;
    await finish(false, { reason, connector: connector.name }, { title: 'A pull request failed while it was being opened', body: `${reason}\nIt was not retried. Check the project before approving a new copy.` });
    return { status: 'failed', reason };
  }
}

/** Opens the pull request on the connector and records it, numbered within its project. The approval id is unique, so it is recorded once. */
async function record(deps: ExecutorDeps, approvalId: string, p: Payload, approvedBy: string): Promise<{ number: number; url: string | null }> {
  const ws = deps.workspaceId;
  const connector = deps.gitConnector!;
  const next = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    const existing = await c.query<{ number: number; url: string | null }>('select number, url from code_pull_requests where approval_id = $1', [approvalId]);
    if (existing.rows[0]) return { number: existing.rows[0].number, url: existing.rows[0].url, done: true };
    const n = (await c.query<{ n: number }>('select coalesce(max(number), 0)::int + 1 as n from code_pull_requests where project_key = $1', [p.projectKey])).rows[0]!.n;
    return { number: Number(n), url: null, done: false };
  });
  if (next.done) return next;
  const project = await withWorkspace(deps.pool, ws, async ({ client: c }) => (await c.query<{ path: string }>('select path from code_projects where key = $1', [p.projectKey])).rows[0]!);
  const opened = await connector.openPullRequest({ projectKey: p.projectKey, projectPath: project.path, branch: p.branch, base: p.base, title: p.title, summary: p.summary, number: next.number });
  await withWorkspace(deps.pool, ws, ({ client: c }) =>
    c.query(
      'insert into code_pull_requests (workspace_id, approval_id, project_key, number, task_id, branch, base, head, title, summary, connector, url, approved_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      [ws, approvalId, p.projectKey, next.number, p.taskId, p.branch, p.base, p.head, p.title, p.summary, connector.name, opened.url, approvedBy],
    ),
  );
  return { number: next.number, url: opened.url };
}

/** On start: an approved pull request that never ran is carried out. One left `executing` is never pushed again: it is recorded if the remote has the commit, and failed with a note if not. */
export async function recoverPrs(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    approved: (await c.query<{ id: string }>("select id from approvals where kind = 'pr.open' and status = 'approved' order by decided_at, id")).rows.map((r) => r.id),
    executing: (await c.query<{ id: string; payload: Payload; decided_by: string | null }>("select id, payload, decided_by from approvals where kind = 'pr.open' and status = 'executing'")).rows,
  }));
  const resumed: string[] = [];
  const unknown: string[] = [];
  for (const a of executing) {
    const landed = deps.gitConnector ? await deps.gitConnector.remoteHead(a.payload.projectKey, a.payload.branch) : null;
    if (landed && landed === a.payload.head) {
      const made = await record(deps, a.id, a.payload, a.decided_by ?? 'founder');
      await withWorkspace(deps.pool, ws, ({ client: c }) => c.query("update approvals set status = 'executed', result = $2 where id = $1 and status = 'executing'", [a.id, JSON.stringify({ number: made.number, recovered: true })]));
      resumed.push(a.id);
    } else {
      await withWorkspace(deps.pool, ws, async ({ client: c }) => {
        await c.query("update approvals set status = 'failed', result = $2 where id = $1 and status = 'executing'", [a.id, JSON.stringify({ reason: 'interrupted while pushing; the push did not land' })]);
        await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', 'A pull request was interrupted', 'The server stopped while this pull request was being opened, and the branch is not on the remote. It was not retried. Ask for it again if you still want it.', $2) on conflict do nothing", [ws, a.id]);
      });
      unknown.push(a.id);
    }
  }
  for (const id of approved) if ((await executePrOpen(deps, id)).status === 'executed') resumed.push(id);
  return { resumed, unknown };
}

export async function releasePrs(deps: ExecutorDeps): Promise<string[]> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string }>("select id from approvals where kind = 'pr.open' and status = 'approved' order by decided_at, id"));
  const released: string[] = [];
  for (const { id } of ids.rows) if ((await executePrOpen(deps, id)).status === 'executed') released.push(id);
  return released;
}
