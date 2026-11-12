import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runInitdb } from '../src/db/initdb';

const fake = path.join(__dirname, 'fixtures', 'fake-initdb.mjs');

function setup(mode: string) {
  const control = mkdtempSync(path.join(tmpdir(), 'conclave-initdb-ctl-'));
  const pgdata = path.join(mkdtempSync(path.join(tmpdir(), 'conclave-initdb-')), 'postgres');
  const options = (over: Partial<Parameters<typeof runInitdb>[0]> = {}) => ({
    initdb: { file: process.execPath, prefixArgs: [fake, control, mode] },
    pgdata,
    user: 'postgres',
    password: 'p'.repeat(32),
    authMethod: 'scram-sha-256',
    flags: ['--encoding=UTF8'],
    timeoutMs: 1_500,
    attempts: 3,
    ...over,
  });
  const calls = () => readFileSync(path.join(control, 'calls.log'), 'utf8').trim().split('\n');
  return { control, pgdata, options, calls };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('initdb with a watchdog', () => {
  it('runs initdb once with the right arguments, hands the password over a file, and removes that file', async () => {
    const t = setup('ok');
    const out = await runInitdb(t.options());
    expect(out.attempts).toBe(1);
    expect(existsSync(path.join(t.pgdata, 'PG_VERSION'))).toBe(true);

    const [call] = t.calls();
    expect(call).toContain(`--pgdata=${t.pgdata}`);
    expect(call).toContain('--username=postgres');
    expect(call).toContain('--auth=scram-sha-256');
    expect(call).toContain('--encoding=UTF8');
    expect(call).not.toContain('p'.repeat(32)); // never on the command line

    const [pwfile, content] = readFileSync(path.join(t.control, 'pwfile-path.txt'), 'utf8').split('\n');
    expect(content).toBe('p'.repeat(32));
    expect(existsSync(pwfile!)).toBe(false);
  });

  it('kills an initdb that stalls, wipes the half-made directory, and tries again', async () => {
    const t = setup('hang-then-ok');
    const started = Date.now();
    const out = await runInitdb(t.options());
    expect(out.attempts).toBe(2);
    expect(t.calls()).toHaveLength(2);
    expect(existsSync(path.join(t.pgdata, 'PG_VERSION'))).toBe(true);
    expect(existsSync(path.join(t.pgdata, 'partial-from-hung-attempt'))).toBe(false);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('gives up after the last attempt with a message that says what happened', async () => {
    const t = setup('hang');
    await expect(runInitdb(t.options({ timeoutMs: 600, attempts: 2 }))).rejects.toThrow(/did not finish within 0\.6s.*2 attempts/s);
    expect(t.calls()).toHaveLength(2);
    expect(existsSync(path.join(t.pgdata, 'partial-from-hung-attempt'))).toBe(false); // nothing half-made is left behind
  });

  it.skipIf(process.platform !== 'win32')('ends the stalled initdb together with its own child process', async () => {
    const t = setup('hang');
    await expect(runInitdb(t.options({ timeoutMs: 800, attempts: 1 }))).rejects.toThrow();
    const grandchild = Number(readFileSync(path.join(t.control, 'grandchild-1.pid'), 'utf8'));
    for (let i = 0; i < 30 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(grandchild)).toBe(false);
  });

  describe('never destroys a database that is already there', () => {
    const holdsDatabase = (pgdata: string) => {
      mkdirSync(pgdata, { recursive: true });
      writeFileSync(path.join(pgdata, 'PG_VERSION'), '18\n');
      writeFileSync(path.join(pgdata, 'your-data'), 'precious');
    };
    const intact = (pgdata: string) =>
      existsSync(path.join(pgdata, 'PG_VERSION')) && readFileSync(path.join(pgdata, 'your-data'), 'utf8') === 'precious';
    const neverRan = (control: string) => !existsSync(path.join(control, 'calls.log'));

    it('refuses a directory that already holds a database, and does not run initdb or remove anything', async () => {
      const t = setup('ok');
      holdsDatabase(t.pgdata);
      await expect(runInitdb(t.options())).rejects.toThrow(/already holds a database/);
      expect(intact(t.pgdata)).toBe(true);
      expect(neverRan(t.control)).toBe(true);
    });

    it('refuses it even when the first attempts would stall, so no retry ever reaches it', async () => {
      const t = setup('hang');
      holdsDatabase(t.pgdata);
      await expect(runInitdb(t.options({ timeoutMs: 500, attempts: 3 }))).rejects.toThrow(/already holds a database/);
      expect(intact(t.pgdata)).toBe(true);
      expect(neverRan(t.control)).toBe(true);
    });

    it('refuses a directory with other files in it that it did not create', async () => {
      const t = setup('ok');
      mkdirSync(t.pgdata, { recursive: true });
      writeFileSync(path.join(t.pgdata, 'someone-elses-file'), 'x');
      await expect(runInitdb(t.options())).rejects.toThrow(/not empty/);
      expect(readFileSync(path.join(t.pgdata, 'someone-elses-file'), 'utf8')).toBe('x');
      expect(neverRan(t.control)).toBe(true);
    });

    it('after a stalled attempt it clears what that attempt made but keeps an empty directory it was given', async () => {
      const t = setup('hang');
      mkdirSync(t.pgdata, { recursive: true }); // given empty, so it is not ours to delete
      await expect(runInitdb(t.options({ timeoutMs: 500, attempts: 2 }))).rejects.toThrow(/did not finish/);
      expect(existsSync(t.pgdata)).toBe(true);
      expect(readdirSync(t.pgdata)).toEqual([]);
    });

    it('removes a directory it created itself when every attempt fails', async () => {
      const t = setup('hang');
      expect(existsSync(t.pgdata)).toBe(false);
      await expect(runInitdb(t.options({ timeoutMs: 500, attempts: 2 }))).rejects.toThrow(/did not finish/);
      expect(existsSync(t.pgdata)).toBe(false);
    });
  });

  it('does not retry a real failure: it reports what initdb said straight away', async () => {
    const t = setup('fail');
    await expect(runInitdb(t.options())).rejects.toThrow(/could not create directory: boom/);
    expect(t.calls()).toHaveLength(1);
  });
});
