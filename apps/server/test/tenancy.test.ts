import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { REPO_ROOT, resolveDataDir, resolvePgPort } from '../src/config';
import { FIRST_START_MARKER, startDatabase, type Database } from '../src/db';
import { withWorkspace } from '../src/db/tenant';

const TABLES = [
  'accounts',
  'action_items',
  'agent_templates',
  'agents',
  'approvals',
  'audit_log',
  'briefs',
  'campaigns',
  'channel_accounts',
  'circuit_breakers',
  'contacts',
  'deal_stage_events',
  'deals',
  'departments',
  'dms',
  'funnel_stages',
  'funnels',
  'goals',
  'hooks',
  'leads',
  'members',
  'messages',
  'outreach_messages',
  'posts',
  'projects',
  'run_events',
  'runs',
  'runtime_pauses',
  'sequence_enrollments',
  'sequence_steps',
  'signals',
  'suppression',
  'tasks',
  'thread_messages',
  'threads',
  'video_ideas',
  'workspace_settings',
  'workspaces',
];
/** Tables keyed by workspace with no `id` of their own, so no unique (workspace_id, id). */
const NO_ID = ['members', 'workspace_settings'];
const TENANT_TABLES = TABLES.filter((t) => t !== 'workspaces');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

function removeDir(dir: string) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

describe('data directory and ports', () => {
  it('defaults DATA_DIR to .conclave-os in the user folder', () => {
    expect(resolveDataDir({})).toBe(join(homedir(), '.conclave-os'));
  });

  it('expands ~ and trims spaces', () => {
    expect(resolveDataDir({ DATA_DIR: '~/elsewhere ' })).toBe(join(homedir(), 'elsewhere'));
  });

  it('refuses a DATA_DIR inside the repo', () => {
    expect(() => resolveDataDir({ DATA_DIR: join(REPO_ROOT, 'data') })).toThrow(/inside the repo/i);
    expect(() => resolveDataDir({ DATA_DIR: REPO_ROOT })).toThrow(/inside the repo/i);
  });

  it('reads PG_PORT, defaults to 54329, rejects nonsense', () => {
    expect(resolvePgPort({})).toBe(54329);
    expect(resolvePgPort({ PG_PORT: '54400' })).toBe(54400);
    expect(() => resolvePgPort({ PG_PORT: 'abc' })).toThrow();
  });
});

describe('tenancy', () => {
  let dir: string;
  let db: Database;
  let wsA: string;
  let wsB: string;
  let deptA: string;
  let deptB: string;

  async function createWorkspace(slug: string): Promise<string> {
    return db.withOwner(async (c) => {
      const r = await c.query<{ id: string }>(
        'insert into workspaces (name, slug) values ($1, $1) returning id',
        [slug],
      );
      return r.rows[0]!.id;
    });
  }

  async function createDepartment(ws: string, key: string): Promise<string> {
    return withWorkspace(db.appPool, ws, async ({ client }) => {
      const r = await client.query<{ id: string }>(
        'insert into departments (workspace_id, key, name) values ($1, $2, $2) returning id',
        [ws, key],
      );
      return r.rows[0]!.id;
    });
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'conclave-tenancy-'));
    db = await startDatabase({ dataDir: dir, port: await freePort() });
    wsA = await createWorkspace('workspace-a');
    wsB = await createWorkspace('workspace-b');
    deptA = await createDepartment(wsA, 'outreach');
    deptB = await createDepartment(wsB, 'outreach');
  });

  afterAll(async () => {
    await db?.stop();
    removeDir(dir);
  });

  it('builds exactly the slice 0 and slice 1 tables, and every one has row-level security forced', async () => {
    const r = await db.withOwner((c) =>
      c.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select c.relname, c.relrowsecurity, c.relforcerowsecurity
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
          order by c.relname`,
      ),
    );
    expect(r.rows.map((x) => x.relname)).toEqual(TABLES);
    for (const row of r.rows) {
      expect(row.relrowsecurity, `${row.relname} enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} forced`).toBe(true);
    }
  });

  it('every tenant table has workspace_id and unique (workspace_id, id), except members and workspace_settings', async () => {
    const cols = await db.withOwner((c) =>
      c.query<{ table_name: string }>(
        `select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'workspace_id'`,
      ),
    );
    expect(cols.rows.map((x) => x.table_name).sort()).toEqual(TENANT_TABLES);

    const uniques = await db.withOwner((c) =>
      c.query<{ table_name: string }>(
        `select tc.table_name
           from information_schema.table_constraints tc
           join information_schema.key_column_usage k
             on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
          where tc.table_schema = 'public' and tc.constraint_type = 'UNIQUE'
          group by tc.table_name, tc.constraint_name
         having array_agg(k.column_name::text order by k.ordinal_position) = array['workspace_id','id']`,
      ),
    );
    const withUnique = new Set(uniques.rows.map((x) => x.table_name));
    for (const t of TENANT_TABLES.filter((t) => !NO_ID.includes(t))) {
      expect(withUnique.has(t), `${t} unique (workspace_id, id)`).toBe(true);
    }
  });

  it('the request role is not a superuser, cannot bypass row-level security, owns nothing and cannot run DDL', async () => {
    const who = await db.appPool.query<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>(
      `select r.rolname, r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user`,
    );
    expect(who.rows[0]).toMatchObject({ rolname: 'conclave_app', rolsuper: false, rolbypassrls: false });

    const owned = await db.appPool.query(
      `select tablename from pg_tables where schemaname = 'public' and tableowner = current_user`,
    );
    expect(owned.rows).toEqual([]);

    await expect(db.appPool.query('create table sneaky (id int)')).rejects.toMatchObject({ code: '42501' });
    await expect(db.appPool.query('alter table departments disable row level security')).rejects.toBeTruthy();
  });

  it('the owner role is not a superuser', async () => {
    const r = await db.withOwner((c) =>
      c.query<{ rolname: string; rolsuper: boolean }>(
        'select rolname, rolsuper from pg_roles where rolname = current_user',
      ),
    );
    expect(r.rows[0]).toEqual({ rolname: 'conclave_owner', rolsuper: false });
  });

  it('stores UTF-8: emoji and non-Latin text round-trip', async () => {
    const text = 'Hello 👋 مرحبا 你好 — café';
    const r = await withWorkspace(db.appPool, wsA, async ({ client }) => {
      await client.query("insert into messages (workspace_id, from_id, body) values ($1, 'utf8-test', $2)", [wsA, text]);
      const body = await client.query<{ body: string }>("select body from messages where from_id = 'utf8-test'");
      const enc = await client.query<{ server_encoding: string }>('show server_encoding');
      return { body: body.rows[0]!.body, encoding: enc.rows[0]!.server_encoding };
    });
    expect(r).toEqual({ body: text, encoding: 'UTF8' });
  });

  it('a query made as workspace A cannot read a row that belongs to workspace B', async () => {
    const asA = await withWorkspace(db.appPool, wsA, ({ client }) =>
      client.query<{ id: string }>('select id from departments'),
    );
    expect(asA.rows.map((x) => x.id)).toEqual([deptA]);

    const direct = await withWorkspace(db.appPool, wsA, ({ client }) =>
      client.query('select id from departments where id = $1', [deptB]),
    );
    expect(direct.rows).toEqual([]);

    const ws = await withWorkspace(db.appPool, wsA, ({ client }) =>
      client.query<{ id: string }>('select id from workspaces'),
    );
    expect(ws.rows.map((x) => x.id)).toEqual([wsA]);
  });

  it('a write made as workspace A cannot put a row into workspace B', async () => {
    await expect(
      withWorkspace(db.appPool, wsA, ({ client }) =>
        client.query("insert into departments (workspace_id, key, name) values ($1, 'sneak', 'sneak')", [wsB]),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const updated = await withWorkspace(db.appPool, wsA, ({ client }) =>
      client.query("update departments set name = 'hijacked' where id = $1", [deptB]),
    );
    expect(updated.rowCount).toBe(0);
  });

  it('a query with no workspace set returns no rows from any table', async () => {
    for (const t of TABLES) {
      const r = await db.appPool.query(`select count(*)::int as n from ${t}`);
      expect(r.rows[0].n, t).toBe(0);
    }
  });

  it('two workspaces can both have a department with the same key', async () => {
    expect(deptA).not.toBe(deptB);
    await expect(createDepartment(wsA, 'outreach')).rejects.toMatchObject({ code: '23505' });
  });

  it("a row in workspace A that points at workspace B's department is refused", async () => {
    const insertAgent = (ws: string, department: string, key: string) =>
      withWorkspace(db.appPool, ws, ({ client }) =>
        client.query(
          `insert into agents (workspace_id, key, name, department_id, runtime, model_alias, role_path)
           values ($1, $2, $2, $3, 'claude-cli', 'writer', 'x')`,
          [ws, key, department],
        ),
      );

    await expect(insertAgent(wsA, deptB, 'crosser')).rejects.toMatchObject({ code: '23503' });
    await expect(insertAgent(wsA, deptA, 'resident')).resolves.toBeTruthy();
  });

  it('on a pool of one connection, a query with no workspace after a workspace request returns 0 rows, not an error', async () => {
    const pool: Pool = db.createAppPool({ max: 1 });
    try {
      const first = await withWorkspace(pool, wsA, ({ client }) => client.query('select id from departments'));
      expect(first.rows).toHaveLength(1);

      const second = await pool.query('select id from departments');
      expect(second.rows).toEqual([]);

      const setting = await pool.query("select current_setting('app.workspace_id', true) as v");
      expect(setting.rows[0].v).toBe(''); // the empty string a bare ::uuid cast would choke on
    } finally {
      await pool.end();
    }
  });

  it('a workspace id that is not a uuid is refused before it reaches the database', async () => {
    await expect(withWorkspace(db.appPool, "x'; drop table tasks; --", async () => 1)).rejects.toThrow();
  });

  describe('the request middleware', () => {
    it('opens one transaction per request with app.workspace_id set', async () => {
      const app = createApp({ pool: db.appPool, workspaceId: wsA });
      app.get('/api/_probe', async (c) => {
        const r = await c.get('tx').client.query(
          "select current_setting('app.workspace_id') as ws, (select count(*)::int from departments) as n",
        );
        return c.json(r.rows[0]);
      });
      const res = await app.request('/api/_probe');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ws: wsA, n: 1 });
    });

    it('rolls the transaction back when the handler fails', async () => {
      const app = createApp({ pool: db.appPool, workspaceId: wsA });
      app.get('/api/_boom', async (c) => {
        await c.get('tx').client.query("insert into departments (workspace_id, key, name) values ($1, 'ghost', 'ghost')", [wsA]);
        throw new Error('boom');
      });
      const res = await app.request('/api/_boom');
      expect(res.status).toBe(500);
      const r = await withWorkspace(db.appPool, wsA, ({ client }) =>
        client.query("select 1 from departments where key = 'ghost'"),
      );
      expect(r.rows).toEqual([]);
    });

    it('does not touch the database for /health', async () => {
      const dead = new Pool({ host: '127.0.0.1', port: 1, connectionTimeoutMillis: 200 });
      try {
        const res = await createApp({ pool: dead, workspaceId: randomUUID() }).request('/health');
        expect(res.status).toBe(200);
      } finally {
        await dead.end();
      }
    });
  });
});

describe('first start', () => {
  it('creates one local workspace, keeps it across restarts, and never stores the superuser', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conclave-firststart-'));
    try {
      const first = await startDatabase({ dataDir: dir, port: await freePort() });
      const count = () =>
        first.withOwner((c) =>
          c.query<{ n: number; slug: string }>(
            "select count(*)::int as n, min(slug) as slug from workspaces where mode = 'local'",
          ),
        );
      const before = (await count()).rows[0]!;
      expect(before).toEqual({ n: 1, slug: 'local' });
      const workspaceId = first.workspaceId;
      await first.stop();
      // A clean shutdown removes postmaster.pid. The library's taskkill leaves it behind, and has left
      // stragglers that wedged the next start.
      expect(existsSync(join(dir, 'postgres', 'postmaster.pid'))).toBe(false);

      const creds = JSON.parse(readFileSync(join(dir, 'secrets', 'db.json'), 'utf8')) as Record<string, string>;
      expect(Object.keys(creds).sort()).toEqual(['appPassword', 'ownerPassword']);

      const second = await startDatabase({ dataDir: dir, port: await freePort() });
      try {
        expect(second.workspaceId).toBe(workspaceId);
        const r = await second.withOwner((c) => c.query<{ n: number }>('select count(*)::int as n from workspaces'));
        expect(r.rows[0]!.n).toBe(1);
      } finally {
        await second.stop();
      }
    } finally {
      removeDir(dir);
    }
  }, 120_000);

  it('rebuilds a cluster that this server began creating and never finished', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conclave-halfmade-'));
    try {
      const first = await startDatabase({ dataDir: dir, port: await freePort() });
      await first.stop();
      // As if the first start died after initdb and before the credentials were written: the credentials
      // are missing and the "first start is running" marker is still there.
      rmSync(join(dir, 'secrets'), { recursive: true, force: true });
      writeFileSync(join(dir, FIRST_START_MARKER), 'started\n');

      const again = await startDatabase({ dataDir: dir, port: await freePort() });
      try {
        expect(existsSync(join(dir, 'secrets', 'db.json'))).toBe(true);
        expect(existsSync(join(dir, FIRST_START_MARKER))).toBe(false); // a finished first start leaves no marker
        expect(again.workspaceId).toMatch(/^[0-9a-f-]{36}$/);
      } finally {
        await again.stop();
      }
    } finally {
      removeDir(dir);
    }
  }, 120_000);

  for (const [what, damage] of [
    ['the credentials file is missing', (file: string) => rmSync(file, { force: true })],
    ['the credentials file is corrupt', (file: string) => writeFileSync(file, '{ this is not json')],
    ['the credentials file has the wrong shape', (file: string) => writeFileSync(file, JSON.stringify({ ownerPassword: 'short' }))],
  ] as const) {
    it(`never deletes a database that already holds data when ${what}`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'conclave-lostcreds-'));
      try {
        const first = await startDatabase({ dataDir: dir, port: await freePort() });
        const workspaceId = first.workspaceId;
        await withWorkspace(first.appPool, workspaceId, ({ client }) =>
          client.query("insert into departments (workspace_id, key, name) values ($1, 'precious', 'Precious')", [workspaceId]),
        );
        await first.stop();

        const file = join(dir, 'secrets', 'db.json');
        const good = readFileSync(file, 'utf8');
        damage(file);

        const refused = await startDatabase({ dataDir: dir, port: await freePort() }).then(
          () => undefined,
          (e: unknown) => e as Error,
        );
        expect(refused?.message).toMatch(/already holds a database/);
        // The message says which file to restore and where it is, and that nothing was deleted.
        expect(refused?.message).toContain(file);
        expect(refused?.message).toContain(join(dir, 'postgres'));
        expect(refused?.message).toMatch(/will not delete a database/);
        expect(existsSync(join(dir, 'postgres', 'PG_VERSION'))).toBe(true); // still there

        // Put the credentials back and everything is exactly as it was.
        writeFileSync(file, good);
        const back = await startDatabase({ dataDir: dir, port: await freePort() });
        try {
          expect(back.workspaceId).toBe(workspaceId);
          const rows = await withWorkspace(back.appPool, workspaceId, ({ client }) =>
            client.query("select name from departments where key = 'precious'"),
          );
          expect(rows.rows).toEqual([{ name: 'Precious' }]);
        } finally {
          await back.stop();
        }
      } finally {
        removeDir(dir);
      }
    }, 150_000);
  }
});
