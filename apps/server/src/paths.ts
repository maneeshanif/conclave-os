import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo root: three levels up from apps/server/src. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homedir(), p.slice(2));
  return p;
}

/** True when `child` is `parent` or inside it. Case-insensitive on Windows. */
export function isInside(child: string, parent: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** An agent's working folder: DATA_DIR/workspaces/<slug>/agents/<agent-key>. Never inside the repo. */
export function agentWorkDir(dataDir: string, workspaceSlug: string, agentKey: string): string {
  const dir = path.join(dataDir, 'workspaces', workspaceSlug, 'agents', agentKey);
  if (isInside(dir, REPO_ROOT)) {
    throw new Error(`Agent working folder ${dir} is inside the repo. Set DATA_DIR outside ${REPO_ROOT}.`);
  }
  return dir;
}

/** DATA_DIR from the environment, default `~/.conclave-os`. Refused when it is inside the repo. */
export function resolveDataDir(env: Record<string, string | undefined> = process.env): string {
  const raw = env.DATA_DIR && env.DATA_DIR.trim() !== '' ? env.DATA_DIR : '~/.conclave-os';
  const dir = path.resolve(expandHome(raw));
  if (isInside(dir, REPO_ROOT)) {
    throw new Error(`DATA_DIR ${dir} is inside the repo (${REPO_ROOT}). Agent folders must never be inside it. Set DATA_DIR elsewhere.`);
  }
  return dir;
}

export const DEFAULT_PG_PORT = 54329;

export function resolvePgPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PG_PORT;
  if (!raw) return DEFAULT_PG_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`PG_PORT "${raw}" is not a port number`);
  return n;
}
