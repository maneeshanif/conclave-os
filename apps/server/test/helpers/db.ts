import { cp, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startDatabase, type Database } from '../../src/db';
import { REPO_ROOT } from '../../src/paths';
import type { System } from '../../src/system';

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

/** A throwaway database in a temp DATA_DIR, plus a System over a copy of the repo's company folder. */
export async function testSystem(osUrl = 'http://127.0.0.1:3100/mcp'): Promise<{ db: Database; sys: System }> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'conclave-db-'));
  const db = await startDatabase({ dataDir, port: await freePort() });
  const companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-co-'));
  await cp(path.join(REPO_ROOT, 'company'), companyRoot, { recursive: true });
  const sys: System = {
    dataDir,
    companyRoot,
    templatesRoot: path.join(REPO_ROOT, 'templates'),
    workspace: { id: db.workspaceId, slug: 'local' },
    app: db.appPool,
    serverPort: 3100,
    osUrl,
    ownsDatabase: true,
    close: () => db.stop(),
  };
  return { db, sys };
}
