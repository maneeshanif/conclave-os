import type pg from 'pg';
import { withWorkspace } from '../db/tenant';

export const STALE_AFTER_MS = 2 * 60_000;
export const MAX_FAILURES_IN_A_ROW = 3;

export interface ReaperDeps {
  pool: pg.Pool;
  workspaceId: string;
  now?: () => Date;
  /** A run heartbeats on every event, so a quiet one can look dead. A run this process is still running is never reaped. */
  isActive?: (runId: string) => boolean;
  staleAfterMs?: number;
}

export interface ReapResult {
  reaped: string[];
  /** Tasks put back to todo, with their session kept, for the agent to pick up again. */
  requeued: { taskId: string; agentId: string }[];
  /** Tasks blocked because this was their third failure in a row. */
  blocked: string[];
}

/**
 * The reaper (SPEC 14, "Run process dies"). A run whose last heartbeat is older than `staleAfterMs`, and which this process
 * is not running, belongs to a process that is gone. It is marked failed, its task is released and put back to todo with
 * its session id so the next run resumes, and a task that has now failed three times in a row is blocked with the reasons.
 * It does not look at the kill switch: cleaning up after a dead run is always safe. Running it again changes nothing.
 */
export async function reapRuns(deps: ReaperDeps): Promise<ReapResult> {
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - (deps.staleAfterMs ?? STALE_AFTER_MS));
  const out: ReapResult = { reaped: [], requeued: [], blocked: [] };
  await withWorkspace(deps.pool, deps.workspaceId, async ({ client: c }) => {
    const stale = await c.query<{ id: string; task_id: string | null; agent_id: string }>(
      "select id, task_id, agent_id from runs where status in ('running', 'queued') and coalesce(heartbeat_at, started_at) < $1 order by started_at nulls first for update skip locked",
      [cutoff],
    );
    for (const run of stale.rows) {
      if (deps.isActive?.(run.id)) continue;
      const marked = await c.query(
        "update runs set status = 'failed', ended_at = $2, error = 'runtime: the run stopped responding (no heartbeat), so the process running it is gone' where id = $1 and status in ('running', 'queued') returning id",
        [run.id, now],
      );
      if (!marked.rows[0]) continue;
      out.reaped.push(run.id);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'system', 'run.failed', $2, $3)", [deps.workspaceId, run.id, JSON.stringify({ reason: 'reaped: no heartbeat' })]);
      if (!run.task_id) continue;

      // Only a task still checked out for this run is ours to release; one a person has since moved is left as it is.
      const task = await c.query<{ status: string }>('select status from tasks where id = $1 for update', [run.task_id]);
      if (task.rows[0]?.status !== 'in_progress') continue;

      // The streak: this run and the failed runs just before it, back to the last run that did not fail.
      const history = await c.query<{ status: string; error: string | null }>('select status, error from runs where task_id = $1 order by coalesce(ended_at, started_at) desc, id desc limit 10', [run.task_id]);
      const streak: string[] = [];
      for (const h of history.rows) {
        if (h.status !== 'failed' && h.status !== 'timed_out') break;
        streak.push(h.error ?? 'no reason recorded');
      }
      if (streak.length >= MAX_FAILURES_IN_A_ROW) {
        const reason = `Failed ${streak.length} times in a row, so it is blocked until a person looks at it. Latest first: ${streak.slice(0, 3).join(' | ')}`.slice(0, 2000);
        await c.query("update tasks set status = 'blocked', locked_by = null, blocked_reason = $2 where id = $1", [run.task_id, reason]);
        out.blocked.push(run.task_id);
      } else {
        await c.query("update tasks set status = 'todo', locked_by = null where id = $1", [run.task_id]);
        out.requeued.push({ taskId: run.task_id, agentId: run.agent_id });
      }
    }
  });
  return out;
}
