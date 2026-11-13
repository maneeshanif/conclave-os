import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/commands/doctor';
import { assertDiskSpace, freeBytes, GB, sweepStaleTempDirs } from '../src/disk';

const HOUR = 3_600_000;

describe('sweeping stale test folders (S3-12)', () => {
  it('removes conclave-* folders older than an hour and nothing else', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sweep-root-'));
    try {
      const make = (name: string, ageMs: number, file = false) => {
        const p = path.join(root, name);
        if (file) writeFileSync(p, 'x');
        else mkdirSync(p);
        if (!file) writeFileSync(path.join(p, 'inner.txt'), 'x');
        const t = new Date(Date.now() - ageMs);
        utimesSync(p, t, t);
        return p;
      };
      const old = make('conclave-db-old', 2 * HOUR);
      const fresh = make('conclave-db-fresh', 5 * 60_000);
      const other = make('someone-elses-folder', 5 * HOUR);
      const oldFile = make('conclave-a-file', 5 * HOUR, true);
      expect(sweepStaleTempDirs(root)).toBe(1);
      expect(existsSync(old)).toBe(false);
      expect(existsSync(fresh)).toBe(true); // may belong to a run in progress
      expect(existsSync(other)).toBe(true);
      expect(existsSync(oldFile)).toBe(true); // only folders
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is quiet when the folder does not exist', () => {
    expect(sweepStaleTempDirs(path.join(tmpdir(), 'no-such-folder-here'))).toBe(0);
  });
});

describe('the disk-space check (S3-12)', () => {
  it('reads real free space', () => {
    expect(freeBytes(tmpdir())).toBeGreaterThan(0);
    expect(freeBytes(path.join(tmpdir(), 'does', 'not', 'exist'))).toBeGreaterThan(0); // nearest existing parent
  });

  it('stops with a clear message under the minimum, and passes above it', () => {
    expect(() => assertDiskSpace('C:/x', 1 * GB, () => 0.4 * GB)).toThrow(/Only 0\.4 GB is free.*at least 1\.0 GB.*conclave-\*/s);
    expect(() => assertDiskSpace('C:/x', 1 * GB, () => 3 * GB)).not.toThrow();
  });
});

describe('doctor and disk space (S3-12)', () => {
  const env = { DATA_DIR: path.join(tmpdir(), 'conclave-disk-doctor') };
  const disk = async (free: number) => (await runChecks(env, { freeBytes: () => free })).find((c) => c.name === 'disk')!;

  it('warns under 5 GB, saying how much is free', async () => {
    const c = await disk(4 * GB);
    expect(c.level).toBe('warn');
    expect(c.detail).toMatch(/4\.0 GB free/);
  });

  it('fails under 1 GB', async () => {
    expect((await disk(0.5 * GB)).level).toBe('fail');
  });

  it('is ok with room to spare', async () => {
    const c = await disk(40 * GB);
    expect(c.level).toBe('ok');
    expect(c.detail).toMatch(/40\.0 GB free/);
  });
}, 60_000);
