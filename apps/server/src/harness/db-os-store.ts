import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { ToolError, type OsStore, type TaskView } from './os-tools';
import type { RunScope } from './run-tokens';

/** The `os` tools on the real database. Every write is scoped to the run's own workspace and task. */
export class DbOsStore implements OsStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly onChange: (workspaceId: string, taskId: string) => void = () => undefined,
  ) {}

  private async inTask<T>(scope: RunScope, fn: (c: pg.PoolClient, taskId: string, agentKey: string) => Promise<T>): Promise<T> {
    if (!scope.taskId) throw new ToolError('This run has no task.');
    const taskId = scope.taskId;
    const out = await withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const t = await c.query<{ status: string; key: string }>(
        'select t.status, a.key from tasks t join agents a on a.id = $2 where t.id = $1',
        [taskId, scope.agentId],
      );
      const row = t.rows[0];
      if (!row) throw new ToolError('This run has no task.');
      if (row.status === 'done' || row.status === 'cancelled') throw new ToolError(`The task is already ${row.status}.`);
      return fn(c, taskId, row.key);
    });
    this.onChange(scope.workspaceId, taskId);
    return out;
  }

  async getTask(scope: RunScope): Promise<TaskView | null> {
    if (!scope.taskId) return null;
    return withWorkspace(this.pool, scope.workspaceId, async ({ client: c }) => {
      const t = await c.query<{ id: string; title: string; body: string | null; status: string }>(
        'select id, title, body, status from tasks where id = $1',
        [scope.taskId],
      );
      if (!t.rows[0]) return null;
      const m = await c.query<{ from_id: string; body: string; created_at: Date }>(
        'select from_id, body, created_at from messages where task_id = $1 order by created_at',
        [scope.taskId],
      );
      return { ...t.rows[0], comments: m.rows.map((r) => ({ from: r.from_id, body: r.body, at: r.created_at.toISOString() })) };
    });
  }

  async comment(scope: RunScope, text: string) {
    await this.inTask(scope, (c, taskId, key) =>
      c.query('insert into messages (workspace_id, task_id, from_id, body) values ($1, $2, $3, $4)', [scope.workspaceId, taskId, `agent:${key}`, text]),
    );
  }

  async completeTask(scope: RunScope, output: string) {
    await this.inTask(scope, async (c, taskId, key) => {
      await c.query('insert into messages (workspace_id, task_id, from_id, body) values ($1, $2, $3, $4)', [scope.workspaceId, taskId, `agent:${key}`, output]);
      await c.query("update tasks set status = 'done', done_at = now(), locked_by = null where id = $1", [taskId]);
    });
  }

  async blockTask(scope: RunScope, reason: string) {
    await this.inTask(scope, (c, taskId) => c.query("update tasks set status = 'blocked', blocked_reason = $2, locked_by = null where id = $1", [taskId, reason]));
  }

  async askFounder(scope: RunScope, question: string) {
    await this.inTask(scope, async (c, taskId, key) => {
      await c.query("insert into messages (workspace_id, task_id, from_id, to_id, body) values ($1, $2, $3, 'founder', $4)", [scope.workspaceId, taskId, `agent:${key}`, question]);
      await c.query("update tasks set status = 'blocked', blocked_reason = $2, locked_by = null where id = $1", [taskId, `Waiting for the founder: ${question}`]);
    });
  }
}
