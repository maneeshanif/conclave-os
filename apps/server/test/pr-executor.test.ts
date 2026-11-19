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
import { GhConnector, LocalGitConnector, selectGitConnector } from '../src/projects/git-connector';
import { openTaskWorktree } from '../src/projects/worktree-service';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await run('git', args, { cwd })).stdout.trim();

let sys: System;
let base = '';
let remotes = '';
let executors: Executors;
let connector: LocalGitConnector;
let agentId = '';
let runId = '';
let store: DbOsStore;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const OK = 'node -e "process.exit(0)"';

async function proposed(key: string) {
  const dir = path.join(base, key);
  await mkdir(dir, { recursive: true });
  await git(dir, 'init', '-b', 'main');
  await git(dir, 'config', 'user.email', 't@example.test');
  await git(dir, 'config', 'user.name', 'T');
  await writeFile(path.join(dir, 'README.md'), '# x\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-m', 'first');
  await sql('insert into code_projects (workspace_id, key, path, default_branch, test_cmd) values ($1, $2, $3, $4, $5)', [ws(), key, dir, 'main', OK]);
  const task = (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, 'Build', 'in_progress', $2, 'founder') returning id", [ws(), agentId])).rows[0].id as string;
  const w = await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: task, projectKey: key, root: path.join(base, 'roots') });
  await writeFile(path.join(w.path, 'index.html'), '<h1>hi</h1>\n');
  await git(w.path, 'add', '.');
  await git(w.path, 'commit', '-m', 'Add page');
  await callOsTool(store, { workspaceId: ws(), agentId, runId, taskId: task }, 'propose_pr', { title: 'Add the page', summary: 'A page.' });
  const a = (await sql("select id from approvals where kind = 'pr.open' and payload->>'taskId' = $1", [task])).rows[0].id as string;
  return { dir, task, approval: a, head: await git(w.path, 'rev-parse', 'HEAD'), branch: `task/${task}` };
}
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);

beforeAll(async () => {
  ({ sys } = await testSystem());
  base = await mkdtemp(path.join(tmpdir(), 'conclave-prx-'));
  remotes = path.join(base, 'remotes');
  connector = new LocalGitConnector(remotes);
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot: sys.companyRoot, from: 'hello@example.test', gitConnector: connector });
  await agentNew(sys, { template: 'coder', department: 'research', id: 'prx-coder', name: 'Coder' });
  agentId = (await sql("select id from agents where key = 'prx-coder'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'codex', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (base) await rm(base, { recursive: true, force: true });
});
beforeEach(() => sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]));

describe('the pr.open executor (S7-6)', () => {
  it('does nothing until approved', async () => {
    const p = await proposed('unapproved');
    expect((await executors.run(p.approval)).status).toBe('already_claimed');
    expect(existsSync(path.join(remotes, 'unapproved.git'))).toBe(false);
  });

  it('pushes the branch to the local bare repo and records the pull request with the branch and the approver', async () => {
    const p = await proposed('happy');
    await approve(p.approval);
    const r = await executors.run(p.approval);
    expect(r.status).toBe('executed');
    expect(await git(path.join(remotes, 'happy.git'), 'rev-parse', p.branch)).toBe(p.head);
    const pr = (await sql('select * from code_pull_requests where approval_id = $1', [p.approval])).rows[0];
    expect(pr).toMatchObject({ project_key: 'happy', branch: p.branch, base: 'main', head: p.head, status: 'open', approved_by: 'founder', number: 1, title: 'Add the page' });
    expect((await sql('select status from approvals where id = $1', [p.approval])).rows[0].status).toBe('executed');
    // The project's own repository is unchanged: its default branch has not moved.
    expect(await git(p.dir, 'rev-list', '--count', 'main')).toBe('1');
  });

  it('claims once: a second run does not push or record again', async () => {
    const p = await proposed('once');
    await approve(p.approval);
    const [a, b] = await Promise.all([executors.run(p.approval), executors.run(p.approval)]);
    expect(a).toEqual(b);
    expect((await executors.run(p.approval)).status).toBe('already_claimed');
    expect((await sql('select count(*)::int as n from code_pull_requests where approval_id = $1', [p.approval])).rows[0].n).toBe(1);
  });

  it('refuses while the kill switch is on, leaving it approved', async () => {
    const p = await proposed('killed');
    await approve(p.approval);
    await sql('update workspace_settings set kill_switch = 1');
    expect((await executors.run(p.approval)).status).toBe('kill_switch');
    expect((await sql('select status from approvals where id = $1', [p.approval])).rows[0].status).toBe('approved');
  });

  it('fails, with a note for the person, when the branch has moved since it was proposed, and pushes nothing', async () => {
    const p = await proposed('moved');
    const wt = (await sql('select path from code_worktrees where task_id = $1', [p.task])).rows[0].path as string;
    await writeFile(path.join(wt, 'later.txt'), 'x');
    await git(wt, 'add', '.');
    await git(wt, 'commit', '-m', 'After the proposal');
    await approve(p.approval);
    const r = await executors.run(p.approval);
    expect(r.status).toBe('failed');
    expect((await sql('select status, result from approvals where id = $1', [p.approval])).rows[0]).toMatchObject({ status: 'failed' });
    expect((await sql("select count(*)::int as n from action_items where approval_id = $1 and kind = 'executor_failed'", [p.approval])).rows[0].n).toBe(1);
    expect(existsSync(path.join(remotes, 'moved.git'))).toBe(false);
  });

  it('after a restart mid-way: one left executing whose push landed is recorded, not pushed again; one whose push did not land is failed, not retried', async () => {
    const landed = await proposed('landed');
    await approve(landed.approval);
    await connector.push({ projectKey: 'landed', projectPath: landed.dir, branch: landed.branch });
    await sql("update approvals set status = 'executing' where id = $1", [landed.approval]);
    const lost = await proposed('lost');
    await approve(lost.approval);
    await sql("update approvals set status = 'executing' where id = $1", [lost.approval]);
    await executors.recover();
    expect((await sql('select status from approvals where id = $1', [landed.approval])).rows[0].status).toBe('executed');
    expect((await sql('select count(*)::int as n from code_pull_requests where approval_id = $1', [landed.approval])).rows[0].n).toBe(1);
    expect((await sql('select status from approvals where id = $1', [lost.approval])).rows[0].status).toBe('failed');
    expect(existsSync(path.join(remotes, 'lost.git'))).toBe(false);
  });
});

describe('choosing the connector (S7-6)', () => {
  it('is the local stand-in unless gh is switched on by name, and a name it does not know is refused', () => {
    expect(selectGitConnector(undefined, remotes)).toBeInstanceOf(LocalGitConnector);
    expect(selectGitConnector('local', remotes)).toBeInstanceOf(LocalGitConnector);
    expect(selectGitConnector('gh', remotes)).toBeInstanceOf(GhConnector);
    expect(() => selectGitConnector('github', remotes)).toThrow(/unknown/i);
  });

  it('is not used by the executor when none is given: the approval is refused', async () => {
    const none = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot: sys.companyRoot, from: 'hello@example.test' });
    const p = await proposed('noconn');
    await approve(p.approval);
    expect((await none.run(p.approval)).status).toBe('refused');
  });
});
