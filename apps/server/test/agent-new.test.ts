import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentNew, renderAll } from '../src/commands/agent-new';
import { bootstrapLocalWorkspace, withWorkspace } from '../src/db/tenancy';
import { REPO_ROOT, isInside } from '../src/paths';
import type { System } from '../src/system';
import { testDb } from './helpers/db';

let db: Awaited<ReturnType<typeof testDb>>;
let sys: System;

beforeAll(async () => {
  db = await testDb();
  const companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-co-'));
  await cp(path.join(REPO_ROOT, 'company'), companyRoot, { recursive: true });
  sys = {
    dataDir: db.dataDir,
    companyRoot,
    templatesRoot: path.join(REPO_ROOT, 'templates'),
    workspace: await bootstrapLocalWorkspace(db.owner, 'Acme'),
    app: db.app,
    owner: db.owner,
    creds: db.cluster.creds,
    serverPort: 3100,
    osUrl: 'http://127.0.0.1:3100/mcp',
    ownsDatabase: true,
    close: async () => undefined,
  };
}, 120_000);
afterAll(async () => db?.close());

describe('pnpm agent:new (S0-4)', () => {
  it('renders the role file, the working folder outside the repo, and registers the agent active at autonomy 0', async () => {
    const r = await agentNew(sys, { template: 'researcher', department: 'research' });
    expect(r.id).toBe('research-researcher');
    expect(r.rolePath).toBe('departments/research/agents/research-researcher/AGENT.md');
    expect(isInside(r.workDir, REPO_ROOT)).toBe(false);
    expect(await readFile(path.join(r.workDir, 'CLAUDE.md'), 'utf8')).toContain('Conclave AI');
    const row = await withWorkspace(sys.app, sys.workspace.id, (c) => c.query("select status, autonomy, runtime from agents where key = 'research-researcher'"));
    expect(row.rows[0]).toEqual({ status: 'active', autonomy: 0, runtime: 'claude-cli' });
  });

  it('picks a free id when the default is taken', async () => {
    const r = await agentNew(sys, { template: 'researcher', department: 'research' });
    expect(r.id).toBe('research-researcher-2');
  });

  it('rejects an unknown department and an unknown template', async () => {
    await expect(agentNew(sys, { template: 'researcher', department: 'nowhere' })).rejects.toThrow(/Unknown department/);
    await expect(agentNew(sys, { template: 'astronaut', department: 'research' })).rejects.toThrow(/Unknown template/);
  });

  it('a one-line runtime change in the role file re-renders the folder for OpenCode', async () => {
    const file = path.join(sys.companyRoot, 'departments/research/agents/research-researcher/AGENT.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('runtime: claude-cli', 'runtime: opencode').replace('model: researcher', 'model: any-model'));
    const out = await renderAll(sys);
    const r = out.find((x) => x.id === 'research-researcher')!;
    expect(r.runtime).toBe('opencode');
    expect(JSON.parse(await readFile(path.join(r.workDir, 'opencode.json'), 'utf8')).default_agent).toBe('research-researcher');
    const row = await withWorkspace(sys.app, sys.workspace.id, (c) => c.query("select runtime from agents where key = 'research-researcher'"));
    expect(row.rows[0].runtime).toBe('opencode');
  });
});
