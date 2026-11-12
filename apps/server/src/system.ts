import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { HOST, REPO_ROOT, resolveDataDir, resolvePgPort, resolvePort } from './config';
import { startDatabase } from './db';

export interface System {
  dataDir: string;
  companyRoot: string;
  templatesRoot: string;
  workspace: { id: string; slug: string };
  /** The request pool: conclave_app, row-level security applies. */
  app: pg.Pool;
  serverPort: number;
  /** URL of the `os` MCP endpoint agents call. */
  osUrl: string;
  /** True when this process started the database and stops it on close. */
  ownsDatabase: boolean;
  close(): Promise<void>;
}

/** The company name is the first `# ` heading of COMPANY.md. */
export async function companyName(companyRoot: string): Promise<string> {
  const text = await readFile(path.join(companyRoot, 'COMPANY.md'), 'utf8').catch(() => '');
  return /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || 'My company';
}

type Env = Record<string, string | undefined>;

/**
 * If the server already runs the database, connect to it: a CLI command must not start a second
 * Postgres on the same DATA_DIR. Uses the credentials file `startDatabase` writes.
 */
async function connectRunning(dataDir: string, port: number): Promise<{ app: pg.Pool; workspaceId: string } | null> {
  const file = path.join(dataDir, 'secrets', 'db.json');
  if (!existsSync(file)) return null;
  const creds = JSON.parse(await readFile(file, 'utf8')) as { ownerPassword: string; appPassword: string };
  const base = { host: HOST, port, database: 'conclave', connectionTimeoutMillis: 1500 };
  const owner = new pg.Client({ ...base, user: 'conclave_owner', password: creds.ownerPassword });
  try {
    await owner.connect();
  } catch {
    return null;
  }
  try {
    const ws = await owner.query<{ id: string }>("select id from workspaces where mode = 'local' order by created_at limit 1");
    if (!ws.rows[0]) return null;
    const app = new pg.Pool({ ...base, user: 'conclave_app', password: creds.appPassword, max: 5 });
    return { app, workspaceId: ws.rows[0].id };
  } finally {
    await owner.end().catch(() => undefined);
  }
}

/** Opens the database for the server or a CLI command: the running one, or S0-2's startDatabase. */
export async function openSystem(env: Env = process.env): Promise<System> {
  const dataDir = resolveDataDir(env);
  const pgPort = resolvePgPort(env);
  // COMPANY_DIR lets a second company (or a test) use its own folder. Default: the repo's company/.
  const companyRoot = env.COMPANY_DIR ? path.resolve(env.COMPANY_DIR) : path.join(REPO_ROOT, 'company');
  const serverPort = resolvePort(env);
  const common = {
    dataDir,
    companyRoot,
    templatesRoot: path.join(REPO_ROOT, 'templates'),
    serverPort,
    osUrl: `http://${HOST}:${serverPort}/mcp`,
  };

  const running = await connectRunning(dataDir, pgPort);
  if (running) {
    return { ...common, workspace: { id: running.workspaceId, slug: 'local' }, app: running.app, ownsDatabase: false, close: () => running.app.end() };
  }
  const db = await startDatabase({ dataDir, port: pgPort });
  return { ...common, workspace: { id: db.workspaceId, slug: 'local' }, app: db.appPool, ownsDatabase: true, close: () => db.stop() };
}
