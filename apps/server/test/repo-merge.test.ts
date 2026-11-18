import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import { LocalGitConnector } from '../src/projects/git-connector';
import { openTaskWorktree } from '../src/projects/worktree-service';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await run('git', args, { cwd })).stdout.trim();

let sys: System;
let base = '';
let remotes = '';
let executors: Executors;
let agentId = '';
let runId = '';
let store: DbOsStore;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = (taskId?: string) => ({ workspaceId: ws(), agentId, runId, ...(taskId ? { taskId } : {}) });
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);
const approvalOf = async (kind: string, key: string) => (await sql('select id, status, payload from approvals where kind = $1 and dedupe_key = $2', [kind, key])).rows[0];

/** A project with an approved, opened pull request. */
async function withPr(key: string) {
  const dir = path.join(base, key);
  await mkdir(dir, { recursive: true });
  await git(dir, 'init', '-b', 'main');
  await git(dir, 'config', 'user.email', 't@example.test');
  await git(dir, 'config', 'user.name', 'T');
  await writeFile(path.join(dir, 'README.md'), '# x\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-m', 'first');
  await sql('insert into code_projects (workspace_id, key, path, default_branch, test_cmd) values ($1, $2, $3, $4, $5)', [ws(), key, dir, 'main', 'node -e "process.exit(0)"']);
  const task = (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, 'Build', 'in_progress', $2, 'founder') returning id", [ws(), agentId])).rows[0].id as string;
  const w = await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: task, projectKey: key, root: path.join(base, 'roots') });
  await writeFile(path.join(w.path, 'index.html'), '<h1>hi</h1>\n');
  await git(w.path, 'add', '.');
  await git(w.path, 'commit', '-m', 'Add page');
  await callOsTool(store, scope(task), 'propose_pr', { title: 'Add the page', summary: 'A page.' });
  const a = (await sql("select id from approvals where kind = 'pr.open' and payload->>'taskId' = $1", [task])).rows[0].id as string;
  await approve(a);
  await executors.run(a);
  return { dir, task, branch: `task/${task}`, prApproval: a };
}

beforeAll(async () => {
  ({ sys } = await testSystem());
  base = await mkdtemp(path.join(tmpdir(), 'conclave-rm-'));
  remotes = path.join(base, 'remotes');
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot: sys.companyRoot, from: 'hello@example.test', gitConnector: new LocalGitConnector(remotes), dataDir: path.join(base, 'data') });
  await agentNew(sys, { template: 'coder', department: 'research', id: 'rm-coder', name: 'Coder' });
  agentId = (await sql("select id from agents where key = 'rm-coder'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'codex', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (base) await rm(base, { recursive: true, force: true });
});
beforeEach(() => sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]));

describe('repo.create (S7-7)', () => {
  it('is proposed, does nothing until approved, then makes a bare repo and a registered project with a first commit', async () => {
    expect(await callOsTool(store, scope(), 'propose_repo', { key: 'acme-site', description: 'Website for Acme' })).toMatch(/Queued for approval/);
    const a = await approvalOf('repo.create', 'repo:acme-site');
    expect(a.status).toBe('pending');
    expect(existsSync(path.join(remotes, 'acme-site.git'))).toBe(false);
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    expect(await git(path.join(remotes, 'acme-site.git'), 'rev-parse', 'refs/heads/main')).toMatch(/^[0-9a-f]{40}$/);
    const p = (await sql("select path, default_branch, test_cmd from code_projects where key = 'acme-site'")).rows[0];
    expect(p).toMatchObject({ default_branch: 'main', test_cmd: null });
    expect(await git(p.path, 'rev-list', '--count', 'main')).toBe('1');
    expect((await executors.run(a.id)).status).toBe('already_claimed');
  });

  it('refuses a bad key or a project that exists, when proposing and again when executing', async () => {
    await expect(callOsTool(store, scope(), 'propose_repo', { key: 'Bad Key', description: 'x' })).rejects.toThrow(/key/i);
    await expect(callOsTool(store, scope(), 'propose_repo', { key: 'acme-site', description: 'again' })).rejects.toThrow(/already/i);
  });
});

describe('merge (S7-7)', () => {
  it('is proposed for an open pull request, and merges into the base on the remote only after approval, recording who approved it', async () => {
    const p = await withPr('merge-ok');
    expect(await callOsTool(store, scope(), 'propose_merge', { project: 'merge-ok', number: 1 })).toMatch(/Queued for approval/);
    const a = await approvalOf('pr.merge', 'merge:merge-ok:1');
    expect(a.payload.tests).toMatchObject({ ok: true });
    const bare = path.join(remotes, 'merge-ok.git');
    expect(await git(bare, 'rev-list', '--count', 'main').catch(() => '0')).toBe('0');
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    expect(await git(bare, 'show', 'main:index.html')).toBe('<h1>hi</h1>');
    const pr = (await sql("select status, merged_by, merged_at from code_pull_requests where project_key = 'merge-ok'")).rows[0];
    expect(pr).toMatchObject({ status: 'merged', merged_by: 'founder' });
    expect(pr.merged_at).not.toBeNull();
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    expect(p.dir).toBeTruthy();
  });

  it('refuses a pull request that is not there, one already merged, and one whose tests have not passed', async () => {
    await expect(callOsTool(store, scope(), 'propose_merge', { project: 'merge-ok', number: 9 })).rejects.toThrow(/no pull request/i);
    await expect(callOsTool(store, scope(), 'propose_merge', { project: 'merge-ok', number: 1 })).rejects.toThrow(/merged/i);
    await withPr('merge-bad');
    await sql("update approvals set payload = jsonb_set(payload, '{tests,ok}', 'false') where kind = 'pr.open' and payload->>'projectKey' = 'merge-bad'");
    await expect(callOsTool(store, scope(), 'propose_merge', { project: 'merge-bad', number: 1 })).rejects.toThrow(/tests/i);
  });

  it('refuses at execution too, if the pull request was merged or closed after the proposal', async () => {
    await withPr('merge-late');
    await callOsTool(store, scope(), 'propose_merge', { project: 'merge-late', number: 1 });
    const a = await approvalOf('pr.merge', 'merge:merge-late:1');
    await sql("update code_pull_requests set status = 'closed' where project_key = 'merge-late'");
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('refused');
    expect(existsSync(path.join(remotes, 'merge-late.git', 'refs', 'heads', 'main'))).toBe(false);
  });
});
