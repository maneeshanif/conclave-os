import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { z } from 'zod';

/**
 * The local database (SPEC 11, local mode). Embedded Postgres keeps its files under DATA_DIR,
 * listens on 127.0.0.1 only, and is reached through two roles:
 * - conclave_owner owns the tables; used only for migrations and bootstrap.
 * - conclave_app serves requests: select, insert, update, delete, nothing else.
 * The initdb superuser is used once, at first start, to create those two, and its password is
 * never stored.
 */
export const DB_NAME = 'conclave';
export const OWNER_ROLE = 'conclave_owner';
export const APP_ROLE = 'conclave_app';

const CredsSchema = z.object({
  port: z.number().int(),
  owner: z.object({ user: z.literal(OWNER_ROLE), password: z.string().min(16) }),
  app: z.object({ user: z.literal(APP_ROLE), password: z.string().min(16) }),
});
export type DbCredentials = z.infer<typeof CredsSchema>;

export interface Cluster {
  creds: DbCredentials;
  stop(): Promise<void>;
}

const secret = () => randomBytes(24).toString('base64url');

export function credsPath(dataDir: string): string {
  return path.join(dataDir, 'secrets', 'db.json');
}

/** Starts the cluster, creating it on first start. A half-made cluster (no credentials file yet) holds no data and is made again. */
export async function startCluster(opts: { dataDir: string; port: number; log?: (m: string) => void }): Promise<Cluster> {
  const pgDir = path.join(opts.dataDir, 'postgres');
  const credFile = credsPath(opts.dataDir);
  const log = opts.log ?? (() => undefined);

  if (existsSync(pgDir) && !existsSync(credFile)) {
    log('found a database folder without credentials: an interrupted first start. Making it again.');
    await rm(pgDir, { recursive: true, force: true });
  }
  const fresh = !existsSync(path.join(pgDir, 'PG_VERSION'));
  const superPassword = secret();
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  const embedded = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: 'postgres',
    password: superPassword,
    port: opts.port,
    persistent: true,
    // Postgres refuses to run as root; the package can run it as a separate user on Linux.
    createPostgresUser: isRoot,
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: (m) => log(String(m)),
    onError: (e) => log(`postgres: ${String(e)}`),
  });

  if (fresh) {
    await mkdir(opts.dataDir, { recursive: true });
    // As root, Postgres runs as a separate user that must be able to reach its folder.
    if (isRoot) await chmod(opts.dataDir, 0o755);
    await embedded.initialise();
  }
  await embedded.start();

  let creds: DbCredentials;
  if (fresh) {
    creds = {
      port: opts.port,
      owner: { user: OWNER_ROLE, password: secret() },
      app: { user: APP_ROLE, password: secret() },
    };
    const su = new pg.Client({ host: '127.0.0.1', port: opts.port, user: 'postgres', password: superPassword, database: 'postgres' });
    await su.connect();
    try {
      const q = (sql: string) => su.query(sql);
      // BYPASSRLS on the owner only: bootstrap must see whether any workspace exists yet.
      await q(`create role ${OWNER_ROLE} login nosuperuser nocreatedb nocreaterole bypassrls password ${pg.escapeLiteral(creds.owner.password)}`);
      await q(`create role ${APP_ROLE} login nosuperuser nocreatedb nocreaterole nobypassrls password ${pg.escapeLiteral(creds.app.password)}`);
      await q(`create database ${DB_NAME} owner ${OWNER_ROLE}`);
      await q(`revoke all on database ${DB_NAME} from public`);
      await q(`grant connect on database ${DB_NAME} to ${APP_ROLE}`);
    } finally {
      await su.end();
    }
    // Only the two role passwords are kept, and only outside the repo.
    await mkdir(path.dirname(credFile), { recursive: true });
    await writeFile(credFile, JSON.stringify(creds, null, 2), { encoding: 'utf8', mode: 0o600 });
    await chmod(credFile, 0o600).catch(() => undefined);
  } else {
    creds = CredsSchema.parse(JSON.parse(await readFile(credFile, 'utf8')));
    creds.port = opts.port;
  }

  return {
    creds,
    stop: async () => {
      await embedded.stop();
    },
  };
}

export function ownerConfig(creds: DbCredentials): pg.ClientConfig {
  return { host: '127.0.0.1', port: creds.port, database: DB_NAME, user: creds.owner.user, password: creds.owner.password };
}

export function appConfig(creds: DbCredentials): pg.ClientConfig {
  return { host: '127.0.0.1', port: creds.port, database: DB_NAME, user: creds.app.user, password: creds.app.password };
}
