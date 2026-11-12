import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { HOST, resolveDataDir, resolvePgPort, resolvePort } from '../config';
import { cleanEnv } from '../runtimes/cli';
import { killTree, resolveCommand, spawnResolved } from '../runtimes/win-process';

export type Level = 'ok' | 'warn' | 'fail';
export interface Check {
  name: string;
  level: Level;
  detail: string;
}

type Env = Record<string, string | undefined>;

/** Runs a command with a timeout. Resolves with exit code and output; never throws. */
function run(cmd: string, args: string[], env: Env, timeoutMs = 20_000): Promise<{ code: number | null; out: string; missing: boolean }> {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    let out = '';
    let missing = false;
    // The same resolver the runtime uses: a real program is started directly, an npm shim is read, and only a
    // command we cannot find falls back to the shell (which then reports "is not recognized", handled below).
    const resolved = resolveCommand({ command: cmd, prefixArgs: [] }, env);
    const child = spawnResolved(resolved, args, { env: env as NodeJS.ProcessEnv, windowsHide: true });
    const timer = setTimeout(() => killTree(child), timeoutMs);
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', (err: NodeJS.ErrnoException) => {
      missing = err.code === 'ENOENT';
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // On Windows a missing command run through the shell exits 1 with "is not recognized".
      if (win && /is not recognized/i.test(out)) missing = true;
      resolve({ code, out: out.trim(), missing });
    });
  });
}

function tcpOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new Socket();
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('error', () => done(false));
    s.connect(port, host, () => done(true));
  });
}

/** Resident memory of a process in MB, or null when it cannot be read. */
async function memoryMb(pid: number, env: Env): Promise<number | null> {
  if (process.platform === 'linux') {
    try {
      const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
      return m ? Math.round(Number(m[1]) / 1024) : null;
    } catch {
      return null;
    }
  }
  if (process.platform === 'win32') {
    const r = await run('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], env);
    const n = Number(r.out.split(/\r?\n/).pop());
    return Number.isFinite(n) && n > 0 ? Math.round(n / 1048576) : null;
  }
  const r = await run('ps', ['-o', 'rss=', '-p', String(pid)], env);
  const n = Number(r.out);
  return Number.isFinite(n) && n > 0 ? Math.round(n / 1024) : null;
}

/** Postgres runs as one postmaster and several children. Sum them where the platform lets us. */
async function postgresMemoryMb(postmasterPid: number, env: Env): Promise<number | null> {
  if (process.platform === 'linux') {
    let total = 0;
    for (const p of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
      try {
        const stat = readFileSync(`/proc/${p}/stat`, 'utf8');
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
        if (Number(p) === postmasterPid || ppid === postmasterPid) total += (await memoryMb(Number(p), env)) ?? 0;
      } catch {
        /* the process ended while we looked */
      }
    }
    return total || null;
  }
  if (process.platform === 'win32') {
    const r = await run('powershell', ['-NoProfile', '-Command', '(Get-Process postgres -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum'], env);
    const n = Number(r.out.split(/\r?\n/).pop());
    return Number.isFinite(n) && n > 0 ? Math.round(n / 1048576) : null;
  }
  return memoryMb(postmasterPid, env);
}

function readPid(file: string): number | null {
  try {
    const n = Number(readFileSync(file, 'utf8').split(/\r?\n/)[0]);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Every check doctor makes (S0-10, SPEC 17). Pure apart from reading the machine; easy to test. */
export async function runChecks(env: Env = process.env): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, level: Level, detail: string) => checks.push({ name, level, detail });

  const [major] = process.versions.node.split('.').map(Number);
  add('node', (major ?? 0) >= 22 ? 'ok' : 'fail', `Node ${process.versions.node}${(major ?? 0) >= 22 ? '' : ' (need 22 or later)'}`);
  const ua = env.npm_config_user_agent ?? '';
  const pnpm = /pnpm\/([\d.]+)/.exec(ua)?.[1];
  add('pnpm', pnpm ? 'ok' : 'warn', pnpm ? `pnpm ${pnpm}` : 'not run through pnpm; run `pnpm doctor`');

  let dataDir = '';
  try {
    dataDir = resolveDataDir(env);
    add('data dir', 'ok', `${dataDir} (outside the repo)`);
  } catch (err) {
    add('data dir', 'fail', (err as Error).message);
  }

  // The CLIs are checked with the same clean environment an agent gets, because that is the sign-in that matters.
  const agentEnv = cleanEnv(env as NodeJS.ProcessEnv, {});
  const claude = await run('claude', ['--version'], agentEnv);
  if (claude.missing || claude.code !== 0) {
    add('claude', 'fail', 'Claude Code (`claude`) is not on PATH. Install it and sign in with `claude` once.');
  } else {
    const status = await run('claude', ['auth', 'status', '--json'], agentEnv);
    let loggedIn = false;
    let method = '';
    try {
      const j = JSON.parse(status.out.slice(status.out.indexOf('{'))) as { loggedIn?: boolean; authMethod?: string };
      loggedIn = j.loggedIn === true;
      method = j.authMethod ?? '';
    } catch {
      /* older CLI without --json */
    }
    add('claude', loggedIn ? 'ok' : 'fail', loggedIn ? `${claude.out.split('\n')[0]}, signed in (${method || 'unknown method'})` : `${claude.out.split('\n')[0]} is installed but not signed in. Run \`claude\` and sign in.`);
  }
  if (env.ANTHROPIC_API_KEY) {
    add('api key', 'warn', 'ANTHROPIC_API_KEY is set for the server. Agents never get it, but remove it until slice 9 so nothing bills the API by accident.');
  }

  const opencode = await run('opencode', ['--version'], agentEnv);
  if (opencode.missing || opencode.code !== 0) {
    add('opencode', 'warn', 'OpenCode is not installed. Slice 0 works without it; S0-11 needs it for the second engine (`npm i -g opencode-ai`).');
  } else {
    const providers = await run('opencode', ['providers', 'list'], agentEnv);
    const none = /\b0 credentials\b/.test(providers.out);
    add('opencode', none ? 'warn' : 'ok', `opencode ${opencode.out.split('\n')[0]}${none ? ', no provider signed in yet (`opencode providers login`) unless you use a local model' : ''}`);
  }

  const pgPort = resolvePgPort(env);
  const pgUp = await tcpOpen(HOST, pgPort);
  const port = resolvePort(env);
  const serverUp = await tcpOpen(HOST, port);
  add('database', pgUp ? 'ok' : 'warn', pgUp ? `Postgres answering on ${HOST}:${pgPort}` : `Postgres is not running on ${HOST}:${pgPort}. Start the server with \`pnpm dev\`.`);
  add('server', serverUp ? 'ok' : 'warn', serverUp ? `server answering on ${HOST}:${port}` : `server is not running on ${HOST}:${port}`);

  // Nothing may listen on another interface before login exists (CLAUDE.md rule 9).
  const others = Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => !!i && !i.internal && i.family === 'IPv4')
    .map((i) => i.address);
  const exposed: string[] = [];
  for (const addr of others) {
    for (const p of [port, pgPort, 3000]) if (await tcpOpen(addr, p, 400)) exposed.push(`${addr}:${p}`);
  }
  add('loopback only', exposed.length ? 'fail' : 'ok', exposed.length ? `reachable from the network: ${exposed.join(', ')}. Only 127.0.0.1 is allowed before login exists.` : `nothing on ${others.join(', ') || 'other interfaces'} answers on ${port}, ${pgPort} or 3000`);

  const inngest = !!(env.INNGEST_DEV || env.INNGEST_BASE_URL || env.INNGEST_EVENT_KEY);
  if (inngest) {
    const base = env.INNGEST_BASE_URL ?? 'http://127.0.0.1:8288';
    const u = new URL(base);
    const up = await tcpOpen(u.hostname, Number(u.port || 80));
    add('inngest', up ? 'ok' : 'fail', up ? `Inngest answering at ${base}` : `Inngest is configured but not answering at ${base}. Start it, or unset INNGEST_DEV to use in-process workflows.`);
  } else {
    add('inngest', 'ok', 'not configured: workflows run in-process with the same limits');
  }

  // Memory (SPEC 17).
  if (dataDir) {
    const pgPid = readPid(path.join(dataDir, 'postgres', 'postmaster.pid'));
    const srvPid = readPid(path.join(dataDir, 'server.pid'));
    const parts: string[] = [];
    if (srvPid && serverUp) parts.push(`server ${(await memoryMb(srvPid, env)) ?? '?'} MB`);
    if (pgPid && pgUp) parts.push(`database ${(await postgresMemoryMb(pgPid, env)) ?? '?'} MB`);
    parts.push(`doctor ${Math.round(process.memoryUsage().rss / 1048576)} MB`);
    add('memory', 'ok', parts.join(', '));
  }
  if (dataDir && !existsSync(dataDir)) add('first start', 'warn', `${dataDir} does not exist yet. \`pnpm dev\` creates it.`);
  return checks;
}

/** `pnpm doctor`: prints each check and exits non-zero if any failed. */
export async function doctor(env: Env = process.env, print: (s: string) => void = console.log): Promise<number> {
  const checks = await runChecks(env);
  const mark: Record<Level, string> = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  for (const c of checks) print(`${mark[c.level]}  ${c.name.padEnd(14)} ${c.detail}`);
  const failed = checks.filter((c) => c.level === 'fail');
  print(failed.length ? `\n${failed.length} problem(s): ${failed.map((c) => c.name).join(', ')}` : '\nAll required checks passed.');
  return failed.length ? 1 : 0;
}
