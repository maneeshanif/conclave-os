import type { Pool } from 'pg';
import { withWorkspace } from '../db/tenant';
import { createWorktree, removeWorktree, WorktreeError } from './worktrees';

export interface TaskWorktree {
  id: string;
  path: string;
  branch: string;
  baseBranch: string;
  projectKey: string;
}

/**
 * Starts a coding task on a project (S7-5): makes its git worktree (S7-2) and records it. If the record cannot be made, the folder is
 * taken away again, so nothing is left half made. A task has one worktree; the project and the task must exist.
 */
export async function openTaskWorktree(pool: Pool, o: { workspaceId: string; taskId: string; projectKey: string; root: string }): Promise<TaskWorktree> {
  const found = await withWorkspace(pool, o.workspaceId, async ({ client: c }) => {
    const task = await c.query('select id from tasks where id = $1', [o.taskId]);
    if (!task.rows[0]) throw new WorktreeError('There is no such task.');
    const project = await c.query<{ id: string; path: string; default_branch: string }>('select id, path, default_branch from code_projects where key = $1', [o.projectKey]);
    if (!project.rows[0]) throw new WorktreeError(`There is no project called "${o.projectKey}".`);
    const had = await c.query('select 1 from code_worktrees where task_id = $1', [o.taskId]);
    if (had.rows[0]) throw new WorktreeError('That task already has a worktree.');
    return project.rows[0];
  });
  const made = await createWorktree({ projectPath: found.path, defaultBranch: found.default_branch, taskId: o.taskId, root: o.root });
  try {
    const row = await withWorkspace(pool, o.workspaceId, ({ client: c }) =>
      c.query<{ id: string }>('insert into code_worktrees (workspace_id, task_id, project_id, path, branch, base_branch) values ($1, $2, $3, $4, $5, $6) returning id', [o.workspaceId, o.taskId, found.id, made.path, made.branch, found.default_branch]),
    );
    return { id: row.rows[0]!.id, path: made.path, branch: made.branch, baseBranch: found.default_branch, projectKey: o.projectKey };
  } catch (err) {
    await removeWorktree({ projectPath: found.path, taskId: o.taskId, root: o.root });
    throw err;
  }
}

/** Takes a task's worktree and branch away and marks it closed. Harmless if the task has none or it is already closed. */
export async function closeTaskWorktree(pool: Pool, o: { workspaceId: string; taskId: string }): Promise<void> {
  const row = await withWorkspace(pool, o.workspaceId, async ({ client: c }) => {
    const r = await c.query<{ path: string; project_path: string }>(
      "select w.path, p.path as project_path from code_worktrees w join code_projects p on p.id = w.project_id and p.workspace_id = w.workspace_id where w.task_id = $1 and w.status = 'open'",
      [o.taskId],
    );
    return r.rows[0];
  });
  if (!row) return;
  const parts = row.path.split(/[\\/]/);
  const taskId = parts.pop()!;
  await removeWorktree({ projectPath: row.project_path, taskId, root: parts.join('/') || '/' });
  await withWorkspace(pool, o.workspaceId, ({ client: c }) => c.query("update code_worktrees set status = 'closed', closed_at = now() where task_id = $1", [o.taskId]));
}
