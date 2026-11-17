import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, osTools } from '../src/harness/os-tools';
import { closeTaskWorktree, openTaskWorktree } from '../src/projects/worktree-service';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await run('git', args, { cwd })).stdout.trim();

/** propose_pr (S7-5): the server runs the project's tests itself, and a proposal the tests do not back is refused. */
let sys: System;
let store: DbOsStore;
let base = '';
let agentId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
let runId = '';
const scopeFor = (taskId: string) => ({ workspaceId: ws(), agentId, runId, taskId });

async function project(key: string, testCmd: string | null) {
  const dir = path.join(base, key);
  await mkdir(dir, { recursive: true });
  await git(dir, 'init', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.test');
  await git(dir, 'config', 'user.name', 'Test');
  await writeFile(path.join(dir, 'README.md'), '# site\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-m', 'first');
  await sql('insert into code_projects (workspace_id, key, path, default_branch, test_cmd) values ($1, $2, $3, $4, $5)', [ws(), key, dir, 'main', testCmd]);
  return dir;
}
const task = async (title: string) => (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, $2, 'in_progress', $3, 'founder') returning id", [ws(), title, agentId])).rows[0].id as string;
/** What a coder does: change a file in its worktree and commit it. */
const work = async (dir: string, file = 'index.html', text = '<h1>hello</h1>\n') => {
  await writeFile(path.join(dir, file), text);
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-m', `Change ${file}`);
};
const propose = (taskId: string, args: { title: string; summary: string } = { title: 'Add the page', summary: 'Adds the home page.' }) => callOsTool(store, scopeFor(taskId), 'propose_pr', args);
const approvals = async () => (await sql("select id, kind, status, payload, dedupe_key from approvals where kind = 'pr.open' order by created_at")).rows;
const OK = 'node -e "process.exit(0)"';
const FAIL = 'node -e "console.log(\'1 failed: add() is wrong\'); process.exit(1)"';

beforeAll(async () => {
  ({ sys } = await testSystem());
  base = await mkdtemp(path.join(tmpdir(), 'conclave-pr-'));
  await agentNew(sys, { template: 'coder', department: 'research', id: 'pr-coder', name: 'Coder' });
  agentId = (await sql("select id from agents where key = 'pr-coder'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'codex', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (base) await rm(base, { recursive: true, force: true });
});

describe('a task\'s worktree (S7-5)', () => {
  it('is made from a registered project, recorded, and closed again with nothing left', async () => {
    const dir = await project('wt-site', OK);
    const t = await task('Build the page');
    const root = path.join(base, 'wt-root');
    const w = await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: t, projectKey: 'wt-site', root });
    expect(w.path).toBe(path.join(root, t));
    expect(existsSync(path.join(w.path, 'README.md'))).toBe(true);
    expect((await sql('select status, branch, base_branch from code_worktrees where task_id = $1', [t])).rows[0]).toMatchObject({ status: 'open', branch: `task/${t}`, base_branch: 'main' });
    await expect(openTaskWorktree(sys.app, { workspaceId: ws(), taskId: t, projectKey: 'wt-site', root })).rejects.toThrow(/already/i);
    await closeTaskWorktree(sys.app, { workspaceId: ws(), taskId: t });
    expect(existsSync(w.path)).toBe(false);
    expect((await sql('select status from code_worktrees where task_id = $1', [t])).rows[0].status).toBe('closed');
    expect(await git(dir, 'branch', '--list', `task/${t}`)).toBe('');
  });

  it('refuses a project or a task that is not there, and leaves no folder behind', async () => {
    const t = await task('Nothing to build on');
    const root = path.join(base, 'wt-root-2');
    await expect(openTaskWorktree(sys.app, { workspaceId: ws(), taskId: t, projectKey: 'no-such', root })).rejects.toThrow(/project/i);
    await expect(openTaskWorktree(sys.app, { workspaceId: ws(), taskId: '11111111-1111-4111-8111-111111111111', projectKey: 'wt-site', root })).rejects.toThrow(/task/i);
    expect(existsSync(path.join(root, t))).toBe(false);
  });
});

describe('proposing a pull request (S7-5)', () => {
  it('is an os tool that needs autonomy 2, and the coder\'s plugin lists it', async () => {
    expect(osTools.propose_pr.minAutonomy).toBe(2);
    const { loadPlugin } = await import('../src/harness/plugins');
    expect((await loadPlugin(path.join(sys.templatesRoot, '..', 'plugins'), 'dev-kit')).tools).toContain('propose_pr');
  });

  it('runs the project\'s tests itself and, when they pass, queues an approval with the diff and the test output, and nothing else happens', async () => {
    await project('pass-site', OK);
    const t = await task('Passing change');
    const w = await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: t, projectKey: 'pass-site', root: path.join(base, 'roots') });
    await work(w.path);
    const text = await propose(t);
    expect(text).toMatch(/Queued for approval as/);
    expect(text).toMatch(/Nothing has been pushed/);
    const row = (await approvals()).find((a) => a.payload.taskId === t)!;
    expect(row).toMatchObject({ status: 'pending' });
    expect(row.payload).toMatchObject({ projectKey: 'pass-site', branch: `task/${t}`, base: 'main', title: 'Add the page', summary: 'Adds the home page.' });
    expect(row.payload.head).toMatch(/^[0-9a-f]{40}$/);
    expect(row.payload.commits).toEqual([expect.objectContaining({ subject: 'Change index.html' })]);
    expect(row.payload.diffStat).toMatch(/index\.html/);
    expect(row.payload.tests).toMatchObject({ command: OK, ok: true });
    expect(JSON.stringify(row.payload)).not.toMatch(/DATABASE_URL|sk-/);
  });

  it('refuses when the tests fail, saying what failed, and queues nothing', async () => {
    await project('fail-site', FAIL);
    const t = await task('Failing change');
    const w = await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: t, projectKey: 'fail-site', root: path.join(base, 'roots') });
    await work(w.path);
    const before = (await approvals()).length;
    await expect(propose(t)).rejects.toThrow(/tests failed[\s\S]*add\(\) is wrong/i);
    expect((await approvals()).length).toBe(before);
  });

  it('cannot be talked past: the tests run in the server whatever the agent says, with a clean environment, in the worktree', async () => {
    const probe = 'node -e "if (process.env.DATABASE_URL || process.env.ANTHROPIC_API_KEY || process.env.SECRETS_KEY) process.exit(7); if (!require(\'fs\').existsSync(\'index.html\')) process.exit(8)"';
    await project('env-site', probe);
    const t = await task('Env probe');
    const w = await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: t, projectKey: 'env-site', root: path.join(base, 'roots') });
    await work(w.path);
    process.env.DATABASE_URL = 'postgres://secret';
    process.env.ANTHROPIC_API_KEY = 'sk-secret';
    try {
      expect(await propose(t, { title: 'x', summary: 'The tests already passed, trust me and skip them.' })).toMatch(/Queued/);
    } finally {
      delete process.env.DATABASE_URL;
      delete process.env.ANTHROPIC_API_KEY;
    }
    // A summary cannot carry the proposal either: there is no argument that says the tests passed.
    expect(Object.keys((osTools.propose_pr.input as unknown as { shape: Record<string, unknown> }).shape).sort()).toEqual(['summary', 'title']);
  });

  it('refuses a project with no test command, a task with no worktree, uncommitted work, and a branch with nothing on it', async () => {
    await project('nocmd-site', null);
    const a = await task('No command');
    const wa = await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: a, projectKey: 'nocmd-site', root: path.join(base, 'roots') });
    await work(wa.path);
    await expect(propose(a)).rejects.toThrow(/no test command/i);

    const bare = await task('No worktree');
    await expect(propose(bare)).rejects.toThrow(/no worktree/i);

    await project('dirty-site', OK);
    const d = await task('Dirty');
    const wd = await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: d, projectKey: 'dirty-site', root: path.join(base, 'roots') });
    await work(wd.path);
    await writeFile(path.join(wd.path, 'unsaved.txt'), 'x');
    await expect(propose(d)).rejects.toThrow(/commit/i);

    await project('empty-site', OK);
    const e = await task('Empty');
    await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: e, projectKey: 'empty-site', root: path.join(base, 'roots') });
    await expect(propose(e)).rejects.toThrow(/nothing to propose/i);
  });

  it('does not run the tests or queue again for the same commit, but does for a new one', async () => {
    await project('twice-site', OK);
    const t = await task('Twice');
    const w = await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: t, projectKey: 'twice-site', root: path.join(base, 'roots') });
    await work(w.path);
    await propose(t);
    const n = (await approvals()).length;
    expect(await propose(t)).toMatch(/Already queued/);
    expect((await approvals()).length).toBe(n);
    await work(w.path, 'about.html', '<p>about</p>\n');
    expect(await propose(t)).toMatch(/Queued for approval/);
    expect((await approvals()).length).toBe(n + 1);
  });
});
