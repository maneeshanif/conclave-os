import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/config';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run('git', args, { cwd });
const json = { 'content-type': 'application/json' };

/** Projects (S7-1): a registered folder with its test and build commands, the thing a coding task works on. */
let sys: System;
let app: ReturnType<typeof createApp>;
let base = '';
const call = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: json, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const repo = async (name: string, branch = 'main') => {
  const dir = path.join(base, name);
  await mkdir(dir, { recursive: true });
  await git(dir, 'init', '-b', branch);
  await git(dir, 'config', 'user.email', 'test@example.test');
  await git(dir, 'config', 'user.name', 'Test');
  await writeFile(path.join(dir, 'README.md'), '# hello\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-m', 'first');
  return dir;
};

beforeAll(async () => {
  ({ sys } = await testSystem());
  base = await mkdtemp(path.join(tmpdir(), 'conclave-projects-'));
  app = createApp({ pool: sys.app, workspaceId: sys.workspace.id, tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot });
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (base) await rm(base, { recursive: true, force: true });
});

describe('registering a project (S7-1)', () => {
  it('registers a git folder with its commands as given, and lists it', async () => {
    const dir = await repo('site');
    const r = await call('POST', '/api/code-projects', { key: 'client-site', path: dir, testCmd: 'pnpm test', buildCmd: 'pnpm build' });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ key: 'client-site', path: dir, defaultBranch: 'main', testCmd: 'pnpm test', buildCmd: 'pnpm build' });
    const list = (await (await call('GET', '/api/code-projects')).json()) as { projects: { key: string; testCmd: string | null }[] };
    expect(list.projects.find((p) => p.key === 'client-site')).toMatchObject({ testCmd: 'pnpm test' });
  });

  it('takes the folder\'s own branch when none is named, and the one you name when it exists', async () => {
    const dir = await repo('trunk', 'trunk');
    expect(await (await call('POST', '/api/code-projects', { key: 'trunk-site', path: dir })).json()).toMatchObject({ defaultBranch: 'trunk', testCmd: null, buildCmd: null });
    const other = await repo('other');
    await git(other, 'branch', 'develop');
    expect(await (await call('POST', '/api/code-projects', { key: 'dev-site', path: other, defaultBranch: 'develop' })).json()).toMatchObject({ defaultBranch: 'develop' });
    const missing = await call('POST', '/api/code-projects', { key: 'bad-branch', path: other, defaultBranch: 'nope' });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toMatch(/branch/i);
  });

  it('refuses a folder that is not a git repository, one that is not there, a subfolder, and a relative path', async () => {
    const plain = path.join(base, 'plain');
    await mkdir(plain, { recursive: true });
    const dir = await repo('with-sub');
    await mkdir(path.join(dir, 'sub'), { recursive: true });
    const cases: [unknown, RegExp][] = [
      [{ key: 'p1', path: plain }, /git/i],
      [{ key: 'p2', path: path.join(base, 'missing') }, /not there|exist/i],
      [{ key: 'p3', path: path.join(dir, 'sub') }, /top|root|whole/i],
      [{ key: 'p4', path: 'relative/path' }, /full path|absolute/i],
    ];
    for (const [body, why] of cases) {
      const r = await call('POST', '/api/code-projects', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(why);
    }
  });

  it('refuses the Conclave repository itself and anything inside it, so an agent can never work in here', async () => {
    for (const p of [REPO_ROOT, path.join(REPO_ROOT, 'apps')]) {
      const r = await call('POST', '/api/code-projects', { key: 'self', path: p });
      expect(r.status, p).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(/conclave|this repo|inside/i);
    }
  });

  it('refuses a key that is not plain, a key in use, a folder in use, and commands with line breaks or too long', async () => {
    const dir = await repo('rules');
    const again = await repo('rules-two');
    expect((await call('POST', '/api/code-projects', { key: 'Has Space', path: dir })).status).toBe(400);
    expect((await call('POST', '/api/code-projects', { key: '../x', path: dir })).status).toBe(400);
    expect((await call('POST', '/api/code-projects', { key: 'rules', path: dir })).status).toBe(201);
    expect((await call('POST', '/api/code-projects', { key: 'rules', path: again })).status).toBe(409); // the key
    expect((await call('POST', '/api/code-projects', { key: 'rules-b', path: dir })).status).toBe(409); // the folder
    expect((await call('POST', '/api/code-projects', { key: 'c1', path: again, testCmd: 'pnpm test\nrm -rf /' })).status).toBe(400);
    expect((await call('POST', '/api/code-projects', { key: 'c2', path: again, buildCmd: 'x'.repeat(501) })).status).toBe(400);
  });

  it('never runs the commands it stores', async () => {
    const dir = await repo('never-run');
    const marker = path.join(base, 'ran.txt');
    const cmd = `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')"`;
    expect((await call('POST', '/api/code-projects', { key: 'never-run', path: dir, testCmd: cmd })).status).toBe(201);
    await expect(run('node', ['-e', `require('fs').accessSync(${JSON.stringify(marker)})`])).rejects.toThrow();
  });

  it('removes a project from the list without touching the folder, and says no to one that is not there', async () => {
    const dir = await repo('removable');
    const made = await call('POST', '/api/code-projects', { key: 'removable', path: dir });
    expect(made.status, JSON.stringify(await made.clone().json())).toBe(201);
    expect((await call('DELETE', '/api/code-projects/removable')).status).toBe(200);
    expect((await call('DELETE', '/api/code-projects/removable')).status).toBe(404);
    expect((await call('DELETE', '/api/code-projects/..%2Fx')).status).toBe(404);
    const { stdout } = await git(dir, 'log', '--oneline');
    expect(stdout).toMatch(/first/); // the folder is as it was
  });
});
