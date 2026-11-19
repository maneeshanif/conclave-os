import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { REPO_ROOT } from '../config';

const run = promisify(execFile);

export class WorktreeError extends Error {}

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

/** Git, run with a clean environment and no prompts, in the folder given. */
const git = async (cwd: string, ...args: string[]): Promise<string> => {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? process.env.USERPROFILE ?? '', GIT_TERMINAL_PROMPT: '0', LANG: 'C' };
  const { stdout } = await run('git', args, { cwd, env, timeout: 60_000 });
  return stdout.trim();
};

const inside = (inner: string, outer: string): boolean => {
  const rel = path.relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const plain = (taskId: string): string => {
  if (!TASK_ID.test(taskId)) throw new WorktreeError('A task id for a worktree is letters, digits and dashes only.');
  return taskId;
};

export interface WorktreeOptions {
  projectPath: string;
  defaultBranch: string;
  taskId: string;
  /** The folder all worktrees go under (DATA_DIR/workspaces/<workspace>/worktrees). Never inside the project or this repository. */
  root: string;
}

/**
 * A coding task's own place to work (S7-2): a git worktree on a new branch `task/<id>`, cut from the project's default branch, in a
 * folder outside both the project and this repository. The project's own folder is not touched. If anything fails, nothing is left half made.
 */
export async function createWorktree(o: WorktreeOptions): Promise<{ path: string; branch: string }> {
  const id = plain(o.taskId);
  const root = path.resolve(o.root);
  const project = await realpath(o.projectPath).catch(() => path.resolve(o.projectPath));
  if (inside(root, project)) throw new WorktreeError('The worktree folder is inside the project. Worktrees live outside it.');
  const self = await realpath(REPO_ROOT).catch(() => REPO_ROOT);
  if (inside(root, self)) throw new WorktreeError('The worktree folder is inside the Conclave repository. An agent must never work there.');
  const dir = path.join(root, id);
  const branch = `task/${id}`;
  if (existsSync(dir)) throw new WorktreeError('That task already has a worktree.');
  try {
    await git(project, 'rev-parse', '--verify', '--quiet', `refs/heads/${o.defaultBranch}`);
  } catch {
    throw new WorktreeError(`The project has no branch called "${o.defaultBranch}".`);
  }
  await mkdir(root, { recursive: true });
  try {
    await git(project, 'worktree', 'add', '-b', branch, dir, o.defaultBranch);
  } catch (err) {
    // Nothing half made: take away whatever git did start.
    await rm(dir, { recursive: true, force: true });
    await git(project, 'worktree', 'prune').catch(() => undefined);
    await git(project, 'branch', '-D', branch).catch(() => undefined);
    throw new WorktreeError(`Git could not make the worktree: ${(err as Error).message.split('\n')[0]}`);
  }
  return { path: dir, branch };
}

/** Takes a task's worktree and its branch away, even with unsaved changes and unmerged commits. Harmless if there is none. */
export async function removeWorktree(o: { projectPath: string; taskId: string; root: string }): Promise<void> {
  const id = plain(o.taskId);
  const dir = path.join(path.resolve(o.root), id);
  await git(o.projectPath, 'worktree', 'remove', '--force', dir).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
  await git(o.projectPath, 'worktree', 'prune').catch(() => undefined);
  await git(o.projectPath, 'branch', '-D', `task/${id}`).catch(() => undefined);
}
