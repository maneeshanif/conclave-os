// Running initdb with a watchdog.
//
// On the Windows laptop initdb sometimes stalls for good: its bootstrap child (`postgres --check`) sits idle and
// nothing ever finishes. A healthy run takes about 4 seconds; about one run in ten stalled, with nothing else
// running and a fresh directory. The library that wraps initdb waits forever, so the server never started.
// So we run initdb ourselves: a deadline per attempt, the whole process tree killed when it passes, the
// half-made directory wiped, and another go. A real failure (a non-zero exit) is not retried; it is reported.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { killTree } from '../runtimes/win-process';

export interface InitdbOptions {
  /** The initdb program. Tests point this at a fake script through `prefixArgs`. */
  initdb: { file: string; prefixArgs?: string[] };
  pgdata: string;
  user: string;
  /** Handed to initdb in a file, never on the command line. */
  password: string;
  authMethod: string;
  flags: string[];
  /** Per attempt. A healthy initdb takes about 4 seconds. */
  timeoutMs?: number;
  attempts?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ATTEMPTS = 3;
/** After the kill, how long to wait for the process to be reported gone before moving on regardless. */
const KILL_GRACE_MS = 5_000;

type Attempt = { kind: 'ok' } | { kind: 'failed'; code: number | null; tail: string } | { kind: 'timeout'; tail: string };

/** initdb needs a program path, a temp folder and a profile, and nothing else from the server's environment. */
function initdbEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { LC_MESSAGES: 'C' };
  for (const k of ['PATH', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'LANG']) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return env;
}

function attemptOnce(o: InitdbOptions, pwfile: string, timeoutMs: number): Promise<Attempt> {
  return new Promise((resolve) => {
    const child = spawn(
      o.initdb.file,
      [
        ...(o.initdb.prefixArgs ?? []),
        `--pgdata=${o.pgdata}`,
        `--auth=${o.authMethod}`,
        `--username=${o.user}`,
        `--pwfile=${pwfile}`,
        '--lc-messages=C',
        ...o.flags,
      ],
      { env: initdbEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let tail = '';
    const keep = (d: Buffer) => {
      tail = (tail + d.toString()).slice(-2_000);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);

    let settled = false;
    const settle = (a: Attempt) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(a);
    };
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // Normally 'close' follows at once. If the kill does not take, do not wait forever.
      setTimeout(() => settle({ kind: 'timeout', tail }), KILL_GRACE_MS).unref();
    }, timeoutMs);

    child.on('error', (err) => settle({ kind: 'failed', code: null, tail: err.message }));
    child.on('close', (code) => {
      if (timedOut) settle({ kind: 'timeout', tail });
      else if (code === 0) settle({ kind: 'ok' });
      else settle({ kind: 'failed', code, tail });
    });
  });
}

const rm = (target: string) => rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });

/**
 * Runs initdb until it finishes. Resolves with how many attempts it took.
 *
 * It only ever removes what an attempt of its own made. A target that already holds a database, or anything
 * else it did not put there, is refused before anything runs: deleting someone's data to make room for a
 * fresh cluster is never an option.
 */
export async function runInitdb(o: InitdbOptions): Promise<{ attempts: number }> {
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = o.attempts ?? DEFAULT_ATTEMPTS;

  const given = existsSync(o.pgdata);
  if (given) {
    if (existsSync(path.join(o.pgdata, 'PG_VERSION'))) {
      throw new Error(`${o.pgdata} already holds a database, so initdb will not run there and nothing was removed.`);
    }
    if (readdirSync(o.pgdata).length > 0) {
      throw new Error(`${o.pgdata} is not empty and was not made by this run, so initdb will not run there and nothing was removed.`);
    }
  }
  // Past this point everything in the directory is from one of our own attempts. A directory we were handed
  // empty is kept (we only empty it); one we created is removed whole.
  const clear = () => {
    if (!existsSync(o.pgdata)) return;
    if (given) for (const name of readdirSync(o.pgdata)) rm(path.join(o.pgdata, name));
    else rm(o.pgdata);
  };

  let lastTail = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    clear(); // never start from what a stalled attempt left behind
    const pwfile = path.join(tmpdir(), `conclave-pgpw-${randomBytes(6).toString('hex')}`);
    writeFileSync(pwfile, `${o.password}\n`, { mode: 0o600 });
    let result: Attempt;
    try {
      result = await attemptOnce(o, pwfile, timeoutMs);
    } finally {
      try {
        unlinkSync(pwfile);
      } catch {
        // already gone
      }
    }
    if (result.kind === 'ok') return { attempts: attempt };
    if (result.kind === 'failed') {
      clear();
      throw new Error(`initdb failed${result.code === null ? '' : ` (exit ${result.code})`}: ${result.tail.trim() || 'no output'}`);
    }
    lastTail = result.tail;
  }
  clear();
  throw new Error(
    `initdb did not finish within ${timeoutMs / 1000}s in ${attempts} attempts, so the database could not be created.` +
      ` Last output:\n${lastTail.trim() || '(none)'}`,
  );
}
