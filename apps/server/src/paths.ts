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
