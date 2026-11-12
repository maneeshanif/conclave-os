import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { appConfig, ownerConfig, startCluster, type Cluster } from '../../src/db/cluster';
import { migrate } from '../../src/db/migrate';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** A throwaway cluster in a temp DATA_DIR, migrated, with an app pool. */
export async function testDb(): Promise<{ dataDir: string; cluster: Cluster; app: pg.Pool; owner: pg.ClientConfig; close(): Promise<void> }> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'conclave-db-'));
  const cluster = await startCluster({ dataDir, port: await freePort() });
  const owner = ownerConfig(cluster.creds);
  await migrate(owner);
  const app = new pg.Pool({ ...appConfig(cluster.creds), max: 4 });
  return {
    dataDir,
    cluster,
    app,
    owner,
    async close() {
      await app.end();
      await cluster.stop();
    },
  };
}
