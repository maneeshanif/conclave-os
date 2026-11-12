import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import EmbeddedPostgres from 'embedded-postgres';
import { Client, Pool } from 'pg';
import { z } from 'zod';
import { runInitdb } from './initdb';

const HOST = '127.0.0.1';
const DB_NAME = 'conclave';
const OWNER_ROLE = 'conclave_owner';
const APP_ROLE = 'conclave_app';
const MIGRATIONS = join(import.meta.dirname, 'migrations');

/** The two passwords the server needs on later starts. The superuser's password is never kept. */
const Credentials = z.object({ ownerPassword: z.string().min(32), appPassword: z.string().min(32) }).strict();
type Credentials = z.infer<typeof Credentials>;

export interface StartOptions {
  /** DATA_DIR. Postgres files go in `postgres/`, role passwords in `secrets/db.json`. */
  dataDir: string;
  port: number;
}

export interface Database {
  /** The request path. Connects as conclave_app: no DDL, no bypassrls, owns nothing. */
  appPool: Pool;
  /** The one local workspace. */
  workspaceId: string;
  /** Another request-role pool, for tests that need a particular size. The caller ends it. */
  createAppPool(options?: { max?: number }): Pool;
  /** A short-lived owner connection. Migrations and bootstrap only, never a request path. */
  withOwner<T>(fn: (client: Client) => Promise<T>): Promise<T>;
  stop(): Promise<void>;
}

function removeDir(dir: string) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 500 });
}

/** The saved logins, or undefined when the file is missing, not JSON, or the wrong shape. Never throws. */
function readCredentials(file: string): Credentials | undefined {
  try {
    const parsed = Credentials.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Written to DATA_DIR before a first start runs initdb and removed once the credentials are saved. It is the
 * only thing that says "this server made that cluster a moment ago and it holds nothing yet", which is the
 * only case in which a cluster without credentials may be deleted.
 */
export const FIRST_START_MARKER = 'first-start.marker';

const secret = () => randomBytes(32).toString('hex');

/**
 * UTF-8 always. Without these, initdb on Windows picks WIN1252 from the system locale and cannot store emoji
 * or most non-Latin text. --no-sync skips fsync of a brand-new cluster; if power fails mid-init the half-made
 * cluster is wiped and rebuilt (see startDatabase), so nothing is lost.
 */
const INITDB_FLAGS = ['--encoding=UTF8', '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8', '--no-sync'];

export async function startDatabase({ dataDir, port }: StartOptions): Promise<Database> {
  const pgDir = join(dataDir, 'postgres');
  const credsFile = join(dataDir, 'secrets', 'db.json');

  const marker = join(dataDir, FIRST_START_MARKER);
  let credentials = readCredentials(credsFile);
  const initialised = existsSync(join(pgDir, 'PG_VERSION'));

  if (initialised && !credentials) {
    // A cluster with no usable logins is one of two things. If the marker is there, this server began creating
    // it and died before saving the logins: it holds nothing, nobody knows its superuser password, so start
    // again. If not, it is a database that was in use and lost its login file. That may hold someone's data, so
    // it is never deleted: the person restores the file, or removes the folder themselves if they mean to.
    if (!existsSync(marker)) {
      throw new Error(
        `${pgDir} already holds a database, but the file with its logins is missing or unreadable: ${credsFile}. ` +
          `Restore that file from a backup and start again. ` +
          `If you want to start over instead, move or delete ${pgDir} yourself; Conclave will not delete a database.`,
      );
    }
    removeDir(pgDir);
  }
  // Saved logins with no cluster belong to nothing. They are not data, so clear them.
  if (!initialised && existsSync(credsFile)) {
    rmSync(credsFile, { force: true });
    credentials = undefined;
  }
  const firstStart = credentials === undefined;
  if (!firstStart) rmSync(marker, { force: true }); // a marker left over from a finished start means nothing

  const superuserPassword = secret(); // used once below, then dropped with this scope
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  // Keep the last lines Postgres printed, so a failed start can say why. The library rejects with
  // `undefined` when the process exits early, which tells nobody anything.
  const recent: string[] = [];
  const remember = (message: unknown) => {
    for (const line of String(message).split(/\r?\n/)) if (line.trim()) recent.push(line.trim());
    if (recent.length > 40) recent.splice(0, recent.length - 40);
  };
  const debug = Boolean(process.env.CONCLAVE_DEBUG_PG); // CONCLAVE_DEBUG_PG=1 prints Postgres output live

  const pg = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: 'postgres',
    password: superuserPassword,
    port,
    persistent: true,
    authMethod: 'scram-sha-256',
    initdbFlags: INITDB_FLAGS,
    postgresFlags: ['-c', `listen_addresses=${HOST}`],
    // Postgres refuses to run as root. On Linux as root (CI, containers) the library runs it as its own user.
    createPostgresUser: isRoot,
    onLog: (message) => {
      remember(message);
      if (debug) console.log('[postgres]', String(message).trim());
    },
    onError: (message) => {
      remember(message);
      console.error('[postgres]', message);
    },
  });

  let started = false;
  try {
    if (firstStart && isRoot) {
      mkdirSync(dataDir, { recursive: true });
      chmodSync(dataDir, 0o755); // the postgres user must be able to reach its folder
    }
    if (firstStart) {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(marker, `${new Date().toISOString()}\n`); // removed again once the logins are saved below
      if (process.platform === 'win32') {
        // On Windows initdb sometimes stalls for good (see initdb.ts), so it runs under a watchdog.
        const { initdb } = await locatePgBinaries();
        const { attempts } = await runInitdb({
          initdb: { file: initdb },
          pgdata: pgDir,
          user: 'postgres',
          password: superuserPassword,
          authMethod: 'scram-sha-256',
          flags: INITDB_FLAGS,
        });
        if (attempts > 1) console.warn(`[db] initdb stalled and was restarted; it finished on attempt ${attempts}`);
      } else {
        await pg.initialise();
      }
    }
    await startPostgres(pg, port, recent);
    started = true;

    if (firstStart) {
      credentials = { ownerPassword: secret(), appPassword: secret() };
      const superuser = pg.getPgClient();
      await superuser.connect();
      try {
        // Passwords are hex, so inlining them is safe. Role statements cannot take parameters.
        await superuser.query(
          `create role ${OWNER_ROLE} login password '${credentials.ownerPassword}'
             nosuperuser nocreatedb nocreaterole bypassrls`,
        );
        await superuser.query(
          `create role ${APP_ROLE} login password '${credentials.appPassword}'
             nosuperuser nocreatedb nocreaterole nobypassrls`,
        );
        await superuser.query(`create database ${DB_NAME} owner ${OWNER_ROLE}`);
        await superuser.query(`revoke all on database ${DB_NAME} from public`);
        await superuser.query(`grant connect on database ${DB_NAME} to ${APP_ROLE}`);
      } finally {
        await superuser.end();
      }
      mkdirSync(join(dataDir, 'secrets'), { recursive: true });
      writeFileSync(credsFile, JSON.stringify(credentials, null, 2), { mode: 0o600 });
      rmSync(marker, { force: true }); // the first start is finished: this cluster now has logins
    }
    const creds = credentials!;

    const connection = (user: string, password: string) => ({
      host: HOST,
      port,
      user,
      password,
      database: DB_NAME,
    });

    const withOwner = async <T>(fn: (client: Client) => Promise<T>): Promise<T> => {
      const client = new Client(connection(OWNER_ROLE, creds.ownerPassword));
      await client.connect();
      try {
        return await fn(client);
      } finally {
        await client.end();
      }
    };

    // Migrations and bootstrap run as the owner, on their own connection, and it is closed after.
    const workspaceId = await withOwner(async (client) => {
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
      return ensureLocalWorkspace(client);
    });

    const createAppPool = (options: { max?: number } = {}) => {
      const pool = new Pool({ ...connection(APP_ROLE, creds.appPassword), max: options.max ?? 10 });
      pool.on('error', (error) => console.error('[db pool]', error.message));
      return pool;
    };
    const appPool = createAppPool();

    return {
      appPool,
      workspaceId,
      createAppPool,
      withOwner,
      async stop() {
        await appPool.end();
        await stopGracefully(pg, pgDir);
      },
    };
  } catch (error) {
    if (started) await stopGracefully(pg, pgDir);
    throw error;
  }
}

const START_TIMEOUT_MS = 90_000;

/** pg.start() with a deadline, and an error that carries what Postgres said. */
async function startPostgres(pg: EmbeddedPostgres, port: number, recent: string[]): Promise<void> {
  const tail = () => (recent.length ? `\nLast Postgres output:\n  ${recent.slice(-15).join('\n  ')}` : '');
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pg.start().catch((error: unknown) => {
        throw new Error(
          `Postgres exited while starting on 127.0.0.1:${port}${error instanceof Error ? `: ${error.message}` : ''}.` +
            ` Is another copy running on that port or using this DATA_DIR?${tail()}`,
        );
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Postgres did not become ready within ${START_TIMEOUT_MS / 1000}s.${tail()}`)),
          START_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    await stopQuietly(pg); // do not leave a half-started postmaster behind
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Where the platform package keeps its programs. pnpm does not let us import that package directly. */
async function locatePgBinaries(): Promise<{ pg_ctl: string; initdb: string }> {
  const platform = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform as string];
  if (!platform) throw new Error(`unsupported platform ${process.platform}`);
  const fromLibrary = createRequire(createRequire(import.meta.url).resolve('embedded-postgres'));
  const entry = fromLibrary.resolve(`@embedded-postgres/${platform}-${process.arch}`);
  return (await import(pathToFileURL(entry).href)) as { pg_ctl: string; initdb: string };
}

const locatePgCtl = async () => (await locatePgBinaries()).pg_ctl;

/**
 * Stop Postgres with a fast, clean shutdown (pg_ctl stop -m fast), so the postmaster ends its own children.
 *
 * The library's stop() runs taskkill /f /t on Windows. That is a crash, not a shutdown, and it can miss a
 * child: a surviving io_worker was seen to wedge the next start on the same DATA_DIR. Seen in a loop of
 * start, stop, wipe, restart; the first-start test now checks that postmaster.pid is gone after a stop.
 * If pg_ctl fails we fall back to the library's kill.
 */
async function stopGracefully(pg: EmbeddedPostgres, pgDir: string): Promise<void> {
  const clean = await locatePgCtl()
    .then(
      (pgCtl) =>
        new Promise<boolean>((resolve) => {
          const child = spawn(pgCtl, ['stop', '-D', pgDir, '-m', 'fast', '-w', '-t', '30'], { stdio: 'ignore' });
          child.on('error', () => resolve(false));
          child.on('close', (code) => resolve(code === 0));
        }),
    )
    .catch(() => false);
  if (clean) {
    // The postmaster is gone. The library still holds its handle, and its stop() would wait forever for an
    // 'exit' event that already fired, so tell it there is nothing left to stop.
    (pg as unknown as { process?: unknown }).process = undefined;
    return;
  }
  await stopQuietly(pg);
}

/**
 * The library's stop() waits for the process's 'exit' event. If the process already exited, that event
 * has already fired and stop() would wait forever, so give it a deadline.
 */
async function stopQuietly(pg: EmbeddedPostgres): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    pg.stop().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 5_000);
    }),
  ]);
  clearTimeout(timer);
}

/** On first start, create the one workspace local mode uses. Later starts find it. */
async function ensureLocalWorkspace(client: Client): Promise<string> {
  const found = await client.query<{ id: string }>(
    "select id from workspaces where mode = 'local' order by created_at limit 1",
  );
  if (found.rows[0]) return found.rows[0].id;
  const created = await client.query<{ id: string }>(
    "insert into workspaces (name, slug, mode) values ('Local', 'local', 'local') returning id",
  );
  return created.rows[0]!.id;
}
