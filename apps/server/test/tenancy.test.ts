import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appConfig, startCluster } from '../src/db/cluster';
import { bootstrapLocalWorkspace, withWorkspace } from '../src/db/tenancy';
import { REPO_ROOT, resolveDataDir } from '../src/paths';
import { freePort, testDb } from './helpers/db';

const TENANT_TABLES = [
  'members', 'departments', 'agent_templates', 'agents', 'goals', 'tasks', 'runs', 'run_events', 'approvals', 'messages', 'audit_log',
];

let db: Awaited<ReturnType<typeof testDb>>;
let wsA = '';
let wsB = '';

async function asOwner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client(db.owner);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function makeWorkspace(slug: string): Promise<string> {
  const id = randomUUID();
  await asOwner(async (c) => {
    await c.query('begin');
    await c.query("select set_config('app.workspace_id', $1, true)", [id]);
    await c.query("insert into workspaces (id, name, slug, mode) values ($1, $2, $3, 'team')", [id, slug, slug]);
    await c.query('commit');
  });
  return id;
}

beforeAll(async () => {
  db = await testDb();
  wsA = await makeWorkspace('a');
  wsB = await makeWorkspace('b');
  for (const [ws, key] of [
    [wsA, 'outreach'],
    [wsB, 'outreach'],
  ] as const) {
    await withWorkspace(db.app, ws, (c) => c.query('insert into departments (workspace_id, key, name) values ($1, $2, $3)', [ws, key, key]));
  }
}, 120_000);
afterAll(async () => db?.close());

describe('database and tenancy (S0-2)', () => {
  it('a query as workspace A cannot read workspace B’s rows', async () => {
    const rows = await withWorkspace(db.app, wsA, (c) => c.query('select workspace_id from departments'));
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].workspace_id).toBe(wsA);
    const ws = await withWorkspace(db.app, wsA, (c) => c.query('select id from workspaces'));
    expect(ws.rows.map((r) => r.id)).toEqual([wsA]);
  });

  it('an insert into workspace B while set to A fails the row-level security check', async () => {
    await expect(
      withWorkspace(db.app, wsA, (c) => c.query('insert into departments (workspace_id, key, name) values ($1, $2, $3)', [wsB, 'x', 'x'])),
    ).rejects.toThrow(/row-level security/);
  });

  it('a query with no workspace set returns zero rows on every tenant table', async () => {
    const c = await db.app.connect();
    try {
      for (const t of ['workspaces', ...TENANT_TABLES]) {
        const r = await c.query(`select count(*)::int as n from ${t}`);
        expect(r.rows[0].n, t).toBe(0);
      }
    } finally {
      c.release();
    }
  });

  it('on a reused pooled connection, no workspace after a set one returns 0 rows, not an error', async () => {
    const one = new pg.Pool({ ...appConfig(db.cluster.creds), max: 1 });
    try {
      await withWorkspace(one, wsA, (c) => c.query('select 1 from departments'));
      const r = await one.query('select count(*)::int as n from departments');
      expect(r.rows[0].n).toBe(0);
    } finally {
      await one.end();
    }
  });

  it('a row in A cannot point at a department in B (composite foreign keys)', async () => {
    const deptB = await withWorkspace(db.app, wsB, (c) => c.query('select id from departments limit 1'));
    await expect(
      withWorkspace(db.app, wsA, (c) =>
        c.query("insert into tasks (workspace_id, department_id, title, created_by) values ($1, $2, 'x', 'test')", [wsA, deptB.rows[0].id]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('the app role is not a superuser, cannot bypass RLS and owns no table', async () => {
    const role = await db.app.query("select rolsuper, rolbypassrls from pg_roles where rolname = 'conclave_app'");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await db.app.query("select count(*)::int as n from pg_tables where schemaname = 'public' and tableowner = 'conclave_app'");
    expect(owned.rows[0].n).toBe(0);
    await expect(db.app.query('create table nope (id int)')).rejects.toThrow(/permission denied/);
  });

  it('every table has row-level security enabled and forced (table-driven, so a new table that skips it fails)', async () => {
    const r = await db.app.query(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname <> '_migrations' order by 1`,
    );
    expect(r.rows.length).toBe(12);
    for (const row of r.rows) {
      expect(row.relrowsecurity, row.relname).toBe(true);
      expect(row.relforcerowsecurity, row.relname).toBe(true);
    }
  });

  it('first start creates exactly one local workspace; a second start creates none', async () => {
    const a = await bootstrapLocalWorkspace(db.owner);
    const b = await bootstrapLocalWorkspace(db.owner);
    expect(b.id).toBe(a.id);
    const n = await asOwner((c) => c.query("select count(*)::int as n from workspaces where mode = 'local'"));
    expect(n.rows[0].n).toBe(1);
  });

  it('restarts on the same DATA_DIR keep the data and the credentials', async () => {
    await db.app.end();
    await db.cluster.stop();
    const port = await freePort();
    const again = await startCluster({ dataDir: db.dataDir, port });
    const pool = new pg.Pool({ ...appConfig(again.creds), max: 2 });
    try {
      const r = await withWorkspace(pool, wsA, (c) => c.query('select key from departments'));
      expect(r.rows.map((x) => x.key)).toEqual(['outreach']);
    } finally {
      await pool.end();
      await again.stop();
    }
    db.close = async () => undefined;
  }, 120_000);
});

describe('DATA_DIR (S0-2)', () => {
  it('defaults to ~/.conclave-os', () => {
    expect(resolveDataDir({})).toBe(path.join(homedir(), '.conclave-os'));
  });
  it('is refused inside the repo', () => {
    expect(() => resolveDataDir({ DATA_DIR: path.join(REPO_ROOT, 'data') })).toThrow(/inside the repo/);
  });
});
