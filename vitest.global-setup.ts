import { tmpdir } from 'node:os';
import { assertDiskSpace, sweepStaleTempDirs } from './apps/server/src/disk';

/** Before a test run: clear conclave-* folders in the temp folder that a crashed run left over an hour ago, then refuse to start if the disk is nearly full. */
export default function setup() {
  const removed = sweepStaleTempDirs(tmpdir());
  if (removed) console.log(`test setup: removed ${removed} stale conclave-* folder(s) from ${tmpdir()}`);
  assertDiskSpace(tmpdir());
}
