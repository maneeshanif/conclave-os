import { resolve } from 'node:path';
import { restoreBackup, runBackup, verifyBackup } from '../backup';
import { resolvePgPort } from '../config';
import { openSystem, ownerAccess } from '../system';

/** `pnpm run backup`: a backup now, the same one the server makes each night. */
export async function backupNow(): Promise<number> {
  const sys = await openSystem();
  try {
    const r = await runBackup({ withOwner: ownerAccess(sys.dataDir, resolvePgPort()), pool: sys.app, workspaceId: sys.workspace.id, dataDir: sys.dataDir, companyRoot: sys.companyRoot });
    if (!r.ok) {
      console.error(`Backup failed: ${r.error}`);
      return 1;
    }
    console.log(`Backup written: ${r.file} (${r.rows} rows)${r.committed ? '. The company folder was committed.' : ''}`);
    return 0;
  } finally {
    await sys.close();
  }
}

/**
 * `pnpm run backup:restore <file>`: checks the file first, then fills an EMPTY database from it. Point DATA_DIR at a new
 * folder. A database that holds data is never touched: the restore stops and says so.
 */
export async function restoreFromFile(file: string | undefined): Promise<number> {
  if (!file) {
    console.error('Usage: pnpm run backup:restore <backup file>   (with DATA_DIR pointing at an empty folder)');
    return 2;
  }
  const path = resolve(file);
  const head = await verifyBackup(path);
  console.log(`${path} is complete: ${head.tables.length} tables made ${head.createdAt}.`);
  const sys = await openSystem();
  try {
    const r = await restoreBackup(ownerAccess(sys.dataDir, resolvePgPort()), path);
    console.log(`Restored ${r.rows} rows in ${r.tables} tables. Restart the server.`);
    return 0;
  } finally {
    await sys.close();
  }
}
