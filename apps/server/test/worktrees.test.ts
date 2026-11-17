import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/config';
import { createWorktree, removeWorktree, WorktreeError } from '../src/projects/worktrees';

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await run('git', args, { cwd })).stdout.trim();

/** Worktrees (S7-2): a coding task gets its own folder and branch, outside the repo, and cleaning up leaves nothing behind. */
let base = '';
let main = '';
let root = '';
const TASK_A = '11111111-1111-4111-8111-111111111111';
const TASK_B = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'conclave-worktrees-'));
  main = path.join(base, 'project');
  root = path.join(base, 'worktrees');
  await mkdir(main, { recursive: true });
  await git(main, 'init', '-b', 'main');
  await git(main, 'config', 'user.email', 'test@example.test');
  await git(main, 'config', 'user.name', 'Test');
  await writeFile(path.join(main, 'README.md'), '# project\n');
  await git(main, 'add', '.');
  await git(main, 'commit', '-m', 'first');
});
afterAll(async () => base && rm(base, { recursive: true, force: true }));

describe('making a worktree for a task (S7-2)', () => {
  it('gives the task its own folder and branch, from the project\'s default branch, outside the project', async () => {
    const w = await createWorktree({ projectPath: main, defaultBranch: 'main', taskId: TASK_A, root });
    expect(w.branch).toBe(`task/${TASK_A}`);
    expect(w.path).toBe(path.join(root, TASK_A));
    expect(existsSync(path.join(w.path, 'README.md'))).toBe(true);
    expect(await git(w.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(`task/${TASK_A}`);
    expect(path.relative(main, w.path).startsWith('..')).toBe(true); // not inside the project
    expect(path.relative(REPO_ROOT, w.path).startsWith('..')).toBe(true); // not inside this repo
  });

  it('gives two tasks on one project separate folders and branches that do not see each other\'s changes', async () => {
    const a = path.join(root, TASK_A);
    const b = (await createWorktree({ projectPath: main, defaultBranch: 'main', taskId: TASK_B, root })).path;
    expect(b).not.toBe(a);
    await writeFile(path.join(a, 'only-in-a.txt'), 'a');
    expect(existsSync(path.join(b, 'only-in-a.txt'))).toBe(false);
    expect(await git(main, 'branch', '--list', 'task/*')).toMatch(new RegExp(`task/${TASK_A}[\\s\\S]*task/${TASK_B}`));
  });

  it('leaves the project\'s own folder exactly as it was, including uncommitted work', async () => {
    await writeFile(path.join(main, 'wip.txt'), 'half done');
    await writeFile(path.join(main, 'README.md'), '# project\nedited\n');
    const before = await git(main, 'status', '--porcelain');
    await createWorktree({ projectPath: main, defaultBranch: 'main', taskId: '33333333-3333-4333-8333-333333333333', root });
    expect(await git(main, 'status', '--porcelain')).toBe(before);
    expect(await readFile(path.join(main, 'wip.txt'), 'utf8')).toBe('half done');
    expect(await git(main, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main'); // still on its own branch
    await rm(path.join(main, 'wip.txt'));
    await git(main, 'checkout', 'README.md');
  });

  it('refuses a task that already has one, a task id that is not plain, a root inside the project or this repo, and a branch that is not there', async () => {
    await expect(createWorktree({ projectPath: main, defaultBranch: 'main', taskId: TASK_A, root })).rejects.toThrow(/already/i);
    for (const bad of ['../escape', 'a/b', 'has space', '', 'x'.repeat(80)]) await expect(createWorktree({ projectPath: main, defaultBranch: 'main', taskId: bad, root }), bad).rejects.toBeInstanceOf(WorktreeError);
    await expect(createWorktree({ projectPath: main, defaultBranch: 'main', taskId: 'inside', root: path.join(main, 'wt') })).rejects.toThrow(/inside/i);
    await expect(createWorktree({ projectPath: main, defaultBranch: 'main', taskId: 'insiderepo', root: path.join(REPO_ROOT, 'wt') })).rejects.toThrow(/inside/i);
    await expect(createWorktree({ projectPath: main, defaultBranch: 'nope', taskId: 'nobranch', root })).rejects.toThrow(/branch/i);
    expect(existsSync(path.join(root, 'nobranch'))).toBe(false); // nothing half made
  });
});

describe('cleaning up (S7-2)', () => {
  it('removes the folder and the branch, even with unsaved changes and commits nobody merged', async () => {
    const dir = path.join(root, TASK_B);
    await writeFile(path.join(dir, 'new.txt'), 'x');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-m', 'work');
    await writeFile(path.join(dir, 'loose.txt'), 'unsaved');
    await removeWorktree({ projectPath: main, taskId: TASK_B, root });
    expect(existsSync(dir)).toBe(false);
    expect(await git(main, 'branch', '--list', `task/${TASK_B}`)).toBe('');
    expect(await git(main, 'worktree', 'list', '--porcelain')).not.toContain(TASK_B);
  });

  it('is harmless to do twice or for a task that never had one, and never touches the project folder', async () => {
    await removeWorktree({ projectPath: main, taskId: TASK_B, root });
    await removeWorktree({ projectPath: main, taskId: 'never-had-one', root });
    expect(existsSync(path.join(main, 'README.md'))).toBe(true);
    await expect(removeWorktree({ projectPath: main, taskId: '../..', root })).rejects.toBeInstanceOf(WorktreeError);
  });
});
