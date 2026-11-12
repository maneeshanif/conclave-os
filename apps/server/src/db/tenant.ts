import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import * as schema from './schema';

export type Tx = {
  /** Drizzle on the transaction's connection. */
  db: NodePgDatabase<typeof schema>;
  /** The same connection, for raw SQL. */
  client: PoolClient;
};

const WorkspaceId = z.uuid();

/**
 * Run `fn` in one transaction that starts with `set local app.workspace_id`.
 * Row-level security reads that setting, so everything inside sees only this workspace.
 * A thrown error rolls the transaction back.
 */
export async function withWorkspace<T>(pool: Pool, workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const id = WorkspaceId.parse(workspaceId);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.workspace_id', $1, true)", [id]);
    const result = await fn({ db: drizzle(client, { schema }), client });
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
