import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { appConfig, credsPath, ownerConfig, startCluster, type Cluster, type DbCredentials } from './db/cluster';
import { migrate } from './db/migrate';
import { bootstrapLocalWorkspace, type Workspace } from './db/tenancy';
import { HOST, resolvePort } from './config';
import { REPO_ROOT, resolveDataDir, resolvePgPort } from './paths';

export interface System {
  dataDir: string;
  companyRoot: string;
  templatesRoot: string;
  workspace: Workspace;
  app: pg.Pool;
  owner: pg.ClientConfig;
  creds: DbCredentials;
  serverPort: number;
  osUrl: string;
  /** True when this process started the database and will stop it. */
  ownsDatabase: boolean;
  close(): Promise<void>;
}

/** The company name is the first `# ` heading of COMPANY.md. */
export async function companyName(companyRoot: string): Promise<string> {
  const text = await readFile(path.join(companyRoot, 'COMPANY.md'), 'utf8').catch(() => '');
  return /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || 'My company';
}

async function reachable(creds: DbCredentials): Promise<boolean> {
  const c = new pg.Client({ ...appConfig(creds), connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    await c.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

/**
 * Opens the database for the server or a CLI command. If the server already runs the database,
 * this connects to it; otherwise it starts it and stops it on close. Migrations run and the local
 * workspace is made on the way.
 */
export async function openSystem(env: Record<string, string | undefined> = process.env, log: (m: string) => void = () => undefined): Promise<System> {
  const dataDir = resolveDataDir(env);
  const pgPort = resolvePgPort(env);
  // COMPANY_DIR lets a second company (or a test) use its own folder. Default: the repo's company/.
  const companyRoot = env.COMPANY_DIR ? path.resolve(env.COMPANY_DIR) : path.join(REPO_ROOT, 'company');
  let cluster: Cluster | undefined;
  let creds: DbCredentials;

  const file = credsPath(dataDir);
  const existing = existsSync(file) ? ({ ...JSON.parse(await readFile(file, 'utf8')), port: pgPort } as DbCredentials) : undefined;
  if (existing && (await reachable(existing))) {
    creds = existing;
  } else {
    cluster = await startCluster({ dataDir, port: pgPort, log: env.CONCLAVE_DEBUG ? log : () => undefined });
    creds = cluster.creds;
  }
  const owner = ownerConfig(creds);
  const applied = await migrate(owner);
  if (applied.length) log(`applied migrations: ${applied.join(', ')}`);
  const workspace = await bootstrapLocalWorkspace(owner, await companyName(companyRoot));
  const app = new pg.Pool({ ...appConfig(creds), max: 5 });
  const serverPort = resolvePort(env);
  return {
    dataDir,
    companyRoot,
    templatesRoot: path.join(REPO_ROOT, 'templates'),
    workspace,
    app,
    owner,
    creds,
    serverPort,
    osUrl: `http://${HOST}:${serverPort}/mcp`,
    ownsDatabase: !!cluster,
    async close() {
      await app.end();
      await cluster?.stop();
    },
  };
}
