import type pg from 'pg';
import { withWorkspace } from '../db/tenant';

/**
 * The task watchdog (A7, borrow audit P3, optional and off until a person switches it on): it looks for a task that stopped for the wrong
 * reason and puts it back in line, once. Three wrong stops: in progress for over two hours with no run alive (a run that died), done with
 * nothing from its agent to show for it (declared done without proof), and waiting for an approval that is not pending any more. A task is
 * put back once only: a second wrong stop is left alone and raised to a person, so the watchdog can never loop a task forever. It changes
 * a task's state and says so on the task; it takes no outside action.
 */
export type WrongStop = 'stuck_in_progress' | 'done_without_proof' | 'waiting_with_nothing';

export interface Found {
  taskId: string;
  title: string;
  reason: WrongStop;
}

const STUCK_AFTER_HOURS = 2;
const DONE_LOOKBACK_DAYS = 14;
const SAYS: Record<WrongStop, string> = {
  stuck_in_progress: 'it was in progress with no run going for over two hours',
  done_without_proof: 'it was marked done but its agent left nothing on it',
  waiting_with_nothing: 'it was waiting for an approval that is no longer pending',
};

export async function runWatchdog(pool: pg.Pool, workspaceId: string, now: Date = new Date()): Promise<Found[]> {
  return withWorkspace(pool, workspaceId, async ({ client: c }) => {
    if (!(await c.query<{ on: boolean }>('select task_watchdog as on from workspace_settings')).rows[0]?.on) return [];
    const found: Found[] = [];
    const add = (rows: { id: string; title: string }[], reason: WrongStop) => rows.forEach((r) => found.push({ taskId: r.id, title: r.title, reason }));
    add(
      (
        await c.query<{ id: string; title: string }>(
          `select t.id, t.title from tasks t where t.status = 'in_progress' and t.locked_at < $1::timestamptz - make_interval(hours => $2)
             and not exists (select 1 from runs r where r.task_id = t.id and r.status in ('running','queued','waiting_approval')) order by t.created_at`,
          [now, STUCK_AFTER_HOURS],
        )
      ).rows,
      'stuck_in_progress',
    );
    add(
      (
        await c.query<{ id: string; title: string }>(
          `select t.id, t.title from tasks t where t.status = 'done' and t.assignee_id is not null and t.kind not in ('meeting_notes','meeting_action') and t.done_at >= $1::timestamptz - make_interval(days => $2)
             and not exists (select 1 from messages m where m.task_id = t.id and m.from_id like 'agent:%') order by t.created_at`,
          [now, DONE_LOOKBACK_DAYS],
        )
      ).rows,
      'done_without_proof',
    );
    add(
      (
        await c.query<{ id: string; title: string }>(
          `select t.id, t.title from tasks t where t.status = 'waiting_approval'
             and not exists (select 1 from approvals a where a.task_id = t.id and a.status = 'pending') order by t.created_at`,
        )
      ).rows,
      'waiting_with_nothing',
    );
    const acted: Found[] = [];
    for (const f of found) {
      const before = (await c.query('select 1 from audit_log where action = $1 and subject = $2', ['watchdog.restarted', f.taskId])).rows[0];
      if (before) {
        // Stopped wrongly a second time: left as it is and raised once, for a person.
        await c.query("insert into action_items (workspace_id, kind, title, body, task_id) select $1, 'watchdog', $2, $3, $4 where not exists (select 1 from action_items where kind = 'watchdog' and task_id = $4)", [workspaceId, `"${f.title}" stopped again`, `The task watchdog already put this task back once, and ${SAYS[f.reason]}. It will not do it again. Task ${f.taskId}.`, f.taskId]);
        continue;
      }
      await c.query("update tasks set status = 'todo', locked_by = null, locked_at = null, done_at = null where id = $1", [f.taskId]);
      await c.query("insert into messages (workspace_id, task_id, from_id, body) values ($1, $2, 'watchdog', $3)", [workspaceId, f.taskId, `The task watchdog put this back in line: ${SAYS[f.reason]}.`]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'watchdog', 'watchdog.restarted', $2, $3)", [workspaceId, f.taskId, JSON.stringify({ reason: f.reason })]);
      acted.push(f);
    }
    return acted;
  });
}
