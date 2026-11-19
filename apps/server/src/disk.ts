import { existsSync, readdirSync, rmSync, statfsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Disk guards (S3-12). Every test file starts its own database in a temp folder, so a crashed run can leave tens of
 * gigabytes behind; once the disk was filled that way and nothing could start. These helpers sweep old test folders, tell
 * how much room is left, and say so in plain words.
 */
export const GB = 1024 ** 3;
/** doctor warns below this. */
export const WARN_FREE_BYTES = 5 * GB;
/** A test run refuses to start below this. */
export const MIN_FREE_BYTES = 1 * GB;

/** Free bytes on the drive that holds `path` (or its nearest existing parent). */
export function freeBytes(path: string): number {
  let p = path;
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  const s = statfsSync(p);
  return Number(s.bavail) * Number(s.bsize);
}

const gb = (n: number) => (n / GB).toFixed(1);

/** Throws with a message that says what to do when `path`'s drive has less than `min` bytes free. */
export function assertDiskSpace(path: string, min = MIN_FREE_BYTES, free: (p: string) => number = freeBytes): void {
  const have = free(path);
  if (have < min) {
    throw new Error(
      `Only ${gb(have)} GB is free on the drive that holds ${path}; the tests need at least ${gb(min)} GB (each test file starts its own database). ` +
        `Free some space (leftover test folders are named conclave-* in the temp folder) and run again.`,
    );
  }
}

/** Removes folders named conclave-* in `root` that were last changed more than `olderThanMs` ago. Returns how many it removed. Never touches anything else. */
export function sweepStaleTempDirs(root: string, olderThanMs = 3_600_000, now = Date.now()): number {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith('conclave-')) continue;
    const full = join(root, name);
    try {
      const s = statSync(full);
      if (!s.isDirectory() || now - s.mtimeMs <= olderThanMs) continue;
      rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      removed++;
    } catch {
      // In use, or gone already: leave it for the next sweep.
    }
  }
  return removed;
}
