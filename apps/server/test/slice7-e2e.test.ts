import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { LocalDeployer } from '../src/projects/deployer';
import { LocalGitConnector } from '../src/projects/git-connector';
import { openTaskWorktree } from '../src/projects/worktree-service';
import { createCliRuntime } from '../src/runtimes/cli';
import type { RunEvent } from '../src/runtimes/types';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await run('git', args, { cwd })).stdout.trim();
const fake = path.join(__dirname, 'fixtures', 'fake-cli.mjs');

/**
 * Slice 7, end to end (S7-11, SPEC 18 row 7). A new repository is approved and made; a spec becomes a task for the coder; a worktree is
 * made; a scripted coder (the codex runtime against a fake codex) changes a file and commits; propose_pr runs the tests in the server and
 * queues an approval; approving it records the pull request on the local connector; merging and deploying are approvals too; the preview
 * is served on loopback and the deployment is in the list the Deployments panel reads. Nothing outside the machine is touched.
 */
let sys: System;
let app: ReturnType<typeof createApp>;
let executors: Executors;
let deployer: LocalDeployer;
let store: DbOsStore;
let base = '';
let agentId = '';
let runId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = (taskId?: string) => ({ workspaceId: ws(), agentId, runId, ...(taskId ? { taskId } : {}) });
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);
const pending = async (kind: string) => (await sql("select id, status from approvals where kind = $1 order by created_at desc limit 1", [kind])).rows[0] as { id: string; status: string };

beforeAll(async () => {
  ({ sys } = await testSystem());
  base = await mkdtemp(path.join(tmpdir(), 'conclave-s7e2e-'));
  const bus = new Bus();
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot, templatesRoot: sys.templatesRoot });
  deployer = new LocalDeployer(path.join(base, 'remotes'), path.join(base, 'deploys'));
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot: sys.companyRoot, from: 'hello@example.test', bus, gitConnector: new LocalGitConnector(path.join(base, 'remotes')), deployer, dataDir: path.join(base, 'data') });
  await agentNew(sys, { template: 'coder', department: 'research', id: 'e2e-coder', name: 'Kofi' });
  agentId = (await sql("select id from agents where key = 'e2e-coder'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'codex', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
}, 240_000);
afterAll(async () => {
  await deployer?.close();
  await sys?.close();
  if (base) await rm(base, { recursive: true, force: true });
});

describe('slice 7: from a spec to a preview (S7-11)', () => {
  let task = '';
  let worktree = '';
  let branch = '';

  it('makes a repository only after it is approved', async () => {
    expect(await callOsTool(store, scope(), 'propose_repo', { key: 'acme-site', description: 'A site for Acme' })).toMatch(/Queued/);
    const a = await pending('repo.create');
    expect(existsSync(path.join(base, 'remotes', 'acme-site.git'))).toBe(false);
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    // The project is registered with its commands: the test checks the page exists, and there is no build, so the folder is served as it is.
    await sql("update code_projects set test_cmd = $1 where key = 'acme-site'", [`node -e "process.exit(require('fs').existsSync('index.html') ? 0 : 1)"`]);
  });

  it('turns a spec into a task for the coder, gives it a worktree outside the repo, and a scripted coder changes a file there', async () => {
    task = (await sql("insert into tasks (workspace_id, title, body, status, assignee_id, created_by) values ($1, 'Home page', 'Build the home page for Acme.', 'in_progress', $2, 'founder') returning id", [ws(), agentId])).rows[0].id;
    const w = await openTaskWorktree(sys.app, { workspaceId: ws(), taskId: task, projectKey: 'acme-site', root: path.join(base, 'worktrees') });
    worktree = w.path;
    branch = w.branch;
    expect(path.relative(sys.companyRoot, worktree).startsWith('..')).toBe(true);
    const runtime = createCliRuntime('codex', { command: { command: process.execPath, prefixArgs: [fake, 'codex', 'edit'] }, baseEnv: process.env });
    const events: RunEvent[] = [];
    for await (const e of runtime.start({ runId: 'r1', workspaceId: ws(), agentId, agentKey: 'e2e-coder', instructions: 'Rules.', taskInput: 'Build the home page for Acme.', workspaceDir: await mkdtemp(path.join(base, 'run-')), workDir: worktree, modelAlias: 'any-model', maxTurns: 10, runToken: 'tok' })) events.push(e);
    expect(events.at(-1), JSON.stringify(events.at(-1))).toMatchObject({ type: 'done' });
    expect(await readFile(path.join(worktree, 'index.html'), 'utf8')).toMatch(/Built by the coder/);
    expect(await git(worktree, 'log', '--format=%s', '-1')).toBe('Add the home page');
  });

  it('runs the tests in the server and queues a pull request, which only an approval opens on the local connector', async () => {
    expect(await callOsTool(store, scope(task), 'propose_pr', { title: 'Add the home page', summary: 'The home page for Acme.' })).toMatch(/Nothing has been pushed/);
    const a = await pending('pr.open');
    expect(existsSync(path.join(base, 'remotes', 'acme-site.git', 'refs', 'heads', 'task'))).toBe(false);
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    expect(await git(path.join(base, 'remotes', 'acme-site.git'), 'rev-parse', branch)).toBe(await git(worktree, 'rev-parse', 'HEAD'));
    expect((await sql("select number, status, approved_by from code_pull_requests where project_key = 'acme-site'")).rows[0]).toMatchObject({ number: 1, status: 'open', approved_by: 'founder' });
  });

  it('merges it only after an approval, and deploys it only after another', async () => {
    await callOsTool(store, scope(task), 'propose_merge', { project: 'acme-site', number: 1 });
    const m = await pending('pr.merge');
    await approve(m.id);
    expect((await executors.run(m.id)).status).toBe('executed');
    expect(await git(path.join(base, 'remotes', 'acme-site.git'), 'show', 'main:index.html')).toMatch(/Built by the coder/);

    await callOsTool(store, scope(task), 'propose_deploy', { project: 'acme-site', client: 'Acme' });
    const d = await pending('deploy');
    expect((await sql("select count(*)::int as n from deployments")).rows[0].n).toBe(0);
    await approve(d.id);
    expect((await executors.run(d.id)).status).toBe('executed');
  });

  it('serves the preview on loopback and lists it for the Deployments panel, with who approved it', async () => {
    const list = ((await (await app.request('/api/deployments')).json()) as { deployments: { projectKey: string; client: string; status: string; url: string; approvedBy: string }[] }).deployments;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ projectKey: 'acme-site', client: 'Acme', status: 'live', approvedBy: 'founder' });
    expect(list[0]!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(await (await fetch(`${list[0]!.url}index.html`)).text()).toMatch(/Built by the coder/);
  });
});
