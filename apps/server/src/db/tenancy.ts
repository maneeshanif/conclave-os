import { randomUUID } from 'node:crypto';
import pg from 'pg';

/** Every query a request makes runs through this: one transaction, workspace set first (SPEC 11). */
export async function withWorkspace<T>(pool: pg.Pool, workspaceId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.workspace_id', $1, true)", [workspaceId]);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  mode: string;
}

/**
 * First start: create the one local workspace if none exists. Runs as the owner role, never on a
 * request path. A second start creates nothing.
 */
export async function bootstrapLocalWorkspace(owner: pg.ClientConfig, name = 'My company'): Promise<Workspace> {
  const client = new pg.Client(owner);
  await client.connect();
  try {
    const existing = await client.query<Workspace>("select id, name, slug, mode from workspaces where mode = 'local' order by created_at limit 1");
    if (existing.rows[0]) return existing.rows[0];
    const id = randomUUID();
    await client.query('begin');
    await client.query("select set_config('app.workspace_id', $1, true)", [id]);
    const row = await client.query<Workspace>(
      "insert into workspaces (id, name, slug, mode) values ($1, $2, 'local', 'local') returning id, name, slug, mode",
      [id, name],
    );
    await client.query('commit');
    return row.rows[0]!;
  } finally {
    await client.end();
  }
}
