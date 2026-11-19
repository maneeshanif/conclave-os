import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import { LocalDeployer } from '../src/projects/deployer';
import { LocalGitConnector } from '../src/projects/git-connector';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

let sys: System;
let base = '';
let executors: Executors;
let connector: LocalGitConnector;
let deployer: LocalDeployer;
let agentId = '';
let runId = '';
let store: DbOsStore;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId });
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);
const BUILD_OK = `node -e "const f=require('fs');f.mkdirSync('dist',{recursive:true});f.writeFileSync('dist/index.html','<h1>built</h1>')"`;
const BUILD_FAIL = 'node -e "console.log(\'build broke\'); process.exit(1)"';

async function repo(key: string, buildCmd: string | null) {
  const workPath = path.join(base, 'projects', key);
  await connector.createRepo({ projectKey: key, workPath, description: 'x' });
  await sql('insert into code_projects (workspace_id, key, path, default_branch, build_cmd) values ($1, $2, $3, $4, $5)', [ws(), key, workPath, 'main', buildCmd]);
}
const deployApproval = async (key: string) => (await sql("select id, status, payload from approvals where kind = 'deploy' and payload->>'projectKey' = $1 order by created_at desc", [key])).rows[0];
const rows = async (key: string) => (await sql('select * from deployments where project_key = $1 order by created_at', [key])).rows;

beforeAll(async () => {
  ({ sys } = await testSystem());
  base = await mkdtemp(path.join(tmpdir(), 'conclave-dep-'));
  connector = new LocalGitConnector(path.join(base, 'remotes'));
  deployer = new LocalDeployer(path.join(base, 'remotes'), path.join(base, 'deploys'));
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot: sys.companyRoot, from: 'hello@example.test', gitConnector: connector, deployer, dataDir: path.join(base, 'data') });
  await agentNew(sys, { template: 'coder', department: 'research', id: 'dep-coder', name: 'Coder' });
  agentId = (await sql("select id from agents where key = 'dep-coder'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'codex', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
}, 240_000);
afterAll(async () => {
  await deployer?.close();
  await sys?.close();
  if (base) await rm(base, { recursive: true, force: true });
});
beforeEach(() => sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]));

describe('deploy (S7-8)', () => {
  it('needs an approval: proposing builds and serves nothing', async () => {
    await repo('site-a', BUILD_OK);
    expect(await callOsTool(store, scope(), 'propose_deploy', { project: 'site-a', client: 'Acme' })).toMatch(/Queued for approval/);
    const a = await deployApproval('site-a');
    expect(a.status).toBe('pending');
    expect(await rows('site-a')).toHaveLength(0);
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    expect(await rows('site-a')).toHaveLength(0);
  });

  it('builds in a copy and serves the result on loopback, recording who approved it', async () => {
    const a = await deployApproval('site-a');
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    const d = (await rows('site-a'))[0];
    expect(d).toMatchObject({ status: 'live', client: 'Acme', approved_by: 'founder', approval_id: a.id });
    expect(d.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(d.ref).toMatch(/^[0-9a-f]{40}$/);
    const res = await fetch(d.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<h1>built</h1>');
    expect((await fetch(`${d.url}../../etc/passwd`)).status).not.toBe(200);
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    expect(await rows('site-a')).toHaveLength(1);
  });

  it('records a failing build as failed, with why, and serves nothing', async () => {
    await repo('site-b', BUILD_FAIL);
    await callOsTool(store, scope(), 'propose_deploy', { project: 'site-b' });
    const a = await deployApproval('site-b');
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('failed');
    const d = (await rows('site-b'))[0];
    expect(d).toMatchObject({ status: 'failed', url: null, approved_by: 'founder' });
    expect(d.error).toMatch(/build broke/);
  });

  it('serves a project with no build command as it is, and refuses a project that is not there or was never pushed', async () => {
    await repo('site-c', null);
    await callOsTool(store, scope(), 'propose_deploy', { project: 'site-c' });
    const a = await deployApproval('site-c');
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    const d = (await rows('site-c'))[0];
    expect(await (await fetch(`${d.url}README.md`)).text()).toMatch(/site-c/);
    await expect(callOsTool(store, scope(), 'propose_deploy', { project: 'nope' })).rejects.toThrow(/project/i);
    await sql('insert into code_projects (workspace_id, key, path, default_branch) values ($1, $2, $3, $4)', [ws(), 'never-pushed', base, 'main']);
    await expect(callOsTool(store, scope(), 'propose_deploy', { project: 'never-pushed' })).rejects.toThrow(/pushed|remote/i);
  });

  it('is refused by the kill switch, and with no deployer on the server', async () => {
    await repo('site-d', BUILD_OK);
    await callOsTool(store, scope(), 'propose_deploy', { project: 'site-d' });
    const a = await deployApproval('site-d');
    await approve(a.id);
    await sql('update workspace_settings set kill_switch = 1');
    expect((await executors.run(a.id)).status).toBe('kill_switch');
    await sql('update workspace_settings set kill_switch = 0');
    const none = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot: sys.companyRoot, from: 'hello@example.test' });
    expect((await none.run(a.id)).status).toBe('refused');
    expect((await rows('site-d'))[0]).toMatchObject({ status: 'failed' });
  });
});
