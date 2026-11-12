import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commitCompany, ensureDailyBackup, restoreBackup, runBackup, verifyBackup, writeBackup, type BackupDeps, type DailyState } from '../src/backup';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import type { System } from '../src/system';
import type { Database } from '../src/db';
import { testSystem } from './helpers/db';

let sys: System;
let db: Database;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const dir = () => join(sys.dataDir, 'backups');
const files = () => (existsSync(dir()) ? readdirSync(dir()).filter((f) => f.startsWith('backup-')).sort() : []);
let clock = new Date(2026, 10, 13, 3, 0, 0);
const deps = (over: Partial<BackupDeps> = {}): BackupDeps => ({ withOwner: db.withOwner, pool: sys.app, workspaceId: ws(), dataDir: sys.dataDir, now: () => clock, ...over });
const items = async () => (await sql("select status, body from action_items where kind = 'backup_failed' order by created_at")).rows;
const count = (s: System, table: string) => withWorkspace(s.app, s.workspace.id, ({ client }) => client.query(`select count(*)::int as n from ${table}`)).then((r) => r.rows[0].n as number);

beforeAll(async () => {
  ({ sys, db } = await testSystem());
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'backup-agent' });
  const agent = (await sql("select id from agents where key = 'backup-agent'")).rows[0].id;
  for (let i = 0; i < 3; i++) await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, $2, 'todo', $3, 'founder')", [ws(), `Task ${i}`, agent]);
  await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at, cost_usd) values ($1, $2, 'manual', 'claude-cli', 'succeeded', now(), 0.25)", [ws(), agent]);
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  clock = new Date(2026, 10, 13, 3, 0, 0);
  rmSync(dir(), { recursive: true, force: true });
  await sql("delete from action_items where kind = 'backup_failed'");
});

describe('writing a backup (S3-9)', () => {
  it('writes one verified file into the data folder, with what is in it', async () => {
    const r = await writeBackup(deps());
    expect(r.file.startsWith(dir())).toBe(true);
    expect(files()).toHaveLength(1);
    expect(r.rows).toBeGreaterThan(5);
    const head = await verifyBackup(r.file);
    expect(head.tables.find((t) => t.name === 'public.tasks')?.rows).toBe(3);
    expect(head.tables.find((t) => t.name === 'public.agents')?.rows).toBeGreaterThan(0);
  });

  it('keeps no half-written file behind', async () => {
    await writeBackup(deps());
    expect(readdirSync(dir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves the database alone: it only reads', async () => {
    const before = await count(sys, 'tasks');
    await writeBackup(deps());
    expect(await count(sys, 'tasks')).toBe(before);
  });
});

describe('checking a dump before it is used (S3-9)', () => {
  it('rejects a file that has been changed, and one that was cut short', async () => {
    const { file } = await writeBackup(deps());
    const good = readFileSync(file);
    const flipped = Buffer.from(good);
    const at = Math.floor(flipped.length / 2);
    flipped.writeUInt8(flipped.readUInt8(at) ^ 0xff, at);
    writeFileSync(file, flipped);
    await expect(verifyBackup(file)).rejects.toThrow();
    writeFileSync(file, good.subarray(0, Math.floor(good.length / 2)));
    await expect(verifyBackup(file)).rejects.toThrow();
    writeFileSync(file, 'not a backup');
    await expect(verifyBackup(file)).rejects.toThrow();
  });
});

describe('restoring (S3-9)', () => {
  it('restores into an empty database: the same workspace, agents, tasks and runs', async () => {
    const { file } = await writeBackup(deps());
    const other = await testSystem();
    try {
      expect(other.sys.workspace.id).not.toBe(ws()); // a different, freshly made database
      const r = await restoreBackup(other.db.withOwner, file);
      expect(r.rows).toBeGreaterThan(5);
      const back = await withWorkspace(other.sys.app, ws(), ({ client }) => client.query("select (select count(*)::int from tasks) as tasks, (select count(*)::int from runs) as runs, (select count(*)::int from agents where key = 'backup-agent') as agents"));
      expect(back.rows[0]).toEqual({ tasks: 3, runs: 1, agents: 1 });
      expect(Number((await withWorkspace(other.sys.app, ws(), ({ client }) => client.query('select cost_usd from runs'))).rows[0].cost_usd)).toBe(0.25);
    } finally {
      await other.sys.close();
    }
  });

  it('refuses a database that holds data, and changes nothing', async () => {
    const { file } = await writeBackup(deps());
    const before = await count(sys, 'tasks');
    await expect(restoreBackup(db.withOwner, file)).rejects.toThrow(/holds data/i);
    expect(await count(sys, 'tasks')).toBe(before);
  });

  it('refuses a bad dump before touching an empty database', async () => {
    const { file } = await writeBackup(deps());
    writeFileSync(file, readFileSync(file).subarray(0, 100));
    const other = await testSystem();
    try {
      await expect(restoreBackup(other.db.withOwner, file)).rejects.toThrow();
      expect(await count(other.sys, 'workspaces')).toBe(1); // its own bootstrap workspace is still there
    } finally {
      await other.sys.close();
    }
  });
});

describe('keeping the last 14 (S3-9)', () => {
  it('prunes older backups beyond the newest 14', async () => {
    for (let d = 1; d <= 16; d++) {
      clock = new Date(2026, 9, d, 3, 0, 0);
      await writeBackup(deps());
    }
    expect(files()).toHaveLength(14);
    expect(files()[0]).toContain('2026-10-03'); // 1 and 2 are gone
    expect(files().at(-1)).toContain('2026-10-16');
  });
});

describe('when the dump fails (S3-9)', () => {
  const broken = (): BackupDeps => deps({ withOwner: async () => Promise.reject(new Error('disk full')) });

  it('leaves the old backups alone and raises one item, however often it fails', async () => {
    await runBackup(deps());
    const before = files();
    expect(before).toHaveLength(1);
    clock = new Date(2026, 10, 14, 3, 0, 0);
    const r1 = await runBackup(broken());
    const r2 = await runBackup(broken());
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(files()).toEqual(before);
    expect(readdirSync(dir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const its = await items();
    expect(its).toHaveLength(1);
    expect(its[0]!.status).toBe('open');
    expect(its[0]!.body).toMatch(/disk full/);
  });

  it('closes the item when the next backup works', async () => {
    await runBackup(broken());
    expect((await items())[0]!.status).toBe('open');
    expect((await runBackup(deps())).ok).toBe(true);
    expect((await items())[0]!.status).toBe('done');
  });
});

describe('the company folder commit (S3-9)', () => {
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...a], { cwd, encoding: 'utf8' }).trim();
  const repo = () => {
    const root = mkdtempSync(join(tmpdir(), 'conclave-git-'));
    git(root, 'init', '-q');
    mkdirSync(join(root, 'company'));
    writeFileSync(join(root, 'company', 'COMPANY.md'), '# Co\n');
    writeFileSync(join(root, 'other.txt'), 'x');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'start');
    return root;
  };

  it('commits when something changed, and only then', async () => {
    const root = repo();
    try {
      const co = join(root, 'company');
      expect(await commitCompany(co, clock)).toBe(false); // nothing changed
      writeFileSync(join(co, 'COMPANY.md'), '# Co\nchanged\n');
      expect(await commitCompany(co, clock)).toBe(true);
      expect(git(root, 'log', '--oneline').split('\n')).toHaveLength(2);
      expect(await commitCompany(co, clock)).toBe(false); // already committed
      expect(git(root, 'log', '--oneline').split('\n')).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('commits only the company folder, never what else was staged', async () => {
    const root = repo();
    try {
      writeFileSync(join(root, 'other.txt'), 'edited');
      git(root, 'add', 'other.txt');
      writeFileSync(join(root, 'company', 'new.md'), 'new');
      expect(await commitCompany(join(root, 'company'), clock)).toBe(true);
      expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe('company/new.md');
      expect(git(root, 'diff', '--cached', '--name-only')).toBe('other.txt'); // still staged, untouched
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is a quiet no for a folder that is not in a git repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'conclave-nogit-'));
    try {
      expect(await commitCompany(plain, clock)).toBe(false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('once a day (S3-9)', () => {
  const daily = (state: DailyState, at = clock, over: Partial<BackupDeps> = {}) => ensureDailyBackup({ ...deps({ now: () => at, ...over }), after: '02:30', state });

  it('does nothing before the time, runs once after it, and not again that day', async () => {
    const state: DailyState = {};
    expect(await daily(state, new Date(2026, 10, 13, 1, 0, 0))).toBeNull();
    expect(files()).toHaveLength(0);
    expect((await daily(state, new Date(2026, 10, 13, 3, 0, 0)))?.ok).toBe(true);
    expect(await daily(state, new Date(2026, 10, 13, 9, 0, 0))).toBeNull();
    expect(files()).toHaveLength(1);
    expect((await daily(state, new Date(2026, 10, 14, 3, 0, 0)))?.ok).toBe(true); // the next day
    expect(files()).toHaveLength(2);
  });

  it('after a failure waits an hour before trying again, instead of trying every minute', async () => {
    const state: DailyState = {};
    const broken = { withOwner: async () => Promise.reject(new Error('boom')) } as Partial<BackupDeps>;
    expect((await daily(state, new Date(2026, 10, 13, 3, 0, 0), broken))?.ok).toBe(false);
    expect(await daily(state, new Date(2026, 10, 13, 3, 30, 0), broken)).toBeNull();
    expect((await daily(state, new Date(2026, 10, 13, 4, 1, 0)))?.ok).toBe(true);
  });
});
