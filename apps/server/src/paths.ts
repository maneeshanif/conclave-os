import path from 'node:path';
import { REPO_ROOT } from './config';

export { REPO_ROOT };

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
