import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { doctor, runChecks } from '../src/commands/doctor';

/** A folder with a fake `claude` (and optionally `opencode`) for PATH, working on Windows and Unix. */
async function fakeBin(opts: { claude?: 'signed-in' | 'signed-out'; opencode?: boolean }): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'conclave-bin-'));
  const node = JSON.stringify(process.execPath);
  const write = async (name: string, js: string) => {
    const script = path.join(dir, `${name}.mjs`);
    await writeFile(script, js);
    await writeFile(path.join(dir, name), `#!/bin/sh\nexec ${node} "${script}" "$@"\n`);
    await chmod(path.join(dir, name), 0o755);
    await writeFile(path.join(dir, `${name}.cmd`), `@echo off\r\n${node} "${script}" %*\r\n`);
  };
  if (opts.claude) {
    const loggedIn = opts.claude === 'signed-in';
    await write(
      'claude',
      `const a = process.argv.slice(2).join(' ');
       if (a === '--version') console.log('2.1.322 (Claude Code)');
       else if (a.startsWith('auth status')) console.log(JSON.stringify({ loggedIn: ${loggedIn}, authMethod: 'claude.ai' }));`,
    );
  }
  if (opts.opencode) await write('opencode', `console.log(process.argv[2] === '--version' ? '1.19.5' : '1 credentials');`);
  return dir;
}

const base = (dir: string) => ({
  PATH: dir,
  PATHEXT: '.CMD;.EXE',
  SYSTEMROOT: process.env.SYSTEMROOT,
  COMSPEC: process.env.COMSPEC,
  DATA_DIR: path.join(tmpdir(), 'conclave-doctor-data'),
  PORT: '3199',
  PG_PORT: '54399',
  npm_config_user_agent: 'pnpm/11.22.0 npm/? node/v24',
});

describe('pnpm doctor (S0-10)', () => {
  it('exits non-zero and names the problem when claude is not on the path', async () => {
    const dir = await fakeBin({ opencode: true });
    const out: string[] = [];
    expect(await doctor(base(dir), (s) => out.push(s))).toBe(1);
    expect(out.join('\n')).toMatch(/FAIL\s+claude\s+Claude Code \(`claude`\) is not on PATH/);
  });

  it('exits zero with a warning when only opencode is missing', async () => {
    const dir = await fakeBin({ claude: 'signed-in' });
    const out: string[] = [];
    expect(await doctor(base(dir), (s) => out.push(s))).toBe(0);
    expect(out.join('\n')).toMatch(/warn\s+opencode\s+OpenCode is not installed/);
  });

  it('fails when claude is installed but not signed in', async () => {
    const checks = await runChecks(base(await fakeBin({ claude: 'signed-out', opencode: true })));
    expect(checks.find((c) => c.name === 'claude')).toMatchObject({ level: 'fail' });
  });

  it('fails a DATA_DIR inside the repo, and warns about an API key', async () => {
    const env = { ...base(await fakeBin({ claude: 'signed-in' })), DATA_DIR: path.resolve(__dirname, 'data'), ANTHROPIC_API_KEY: 'x' };
    const checks = await runChecks(env);
    expect(checks.find((c) => c.name === 'data dir')).toMatchObject({ level: 'fail' });
    expect(checks.find((c) => c.name === 'api key')).toMatchObject({ level: 'warn' });
  });

  it('prints memory use', async () => {
    const checks = await runChecks(base(await fakeBin({ claude: 'signed-in' })));
    expect(checks.find((c) => c.name === 'memory')?.detail).toMatch(/doctor \d+ MB/);
  });
});
