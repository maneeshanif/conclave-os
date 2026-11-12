import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCliRuntime } from '../src/runtimes/cli';
import type { RunEvent, RunRequest } from '../src/runtimes/types';
import { killCommand, parseCmdShim, quoteForCmd, resolveWindowsCommand, spawnArgs } from '../src/runtimes/win-process';

// The text of the shim npm wrote for opencode on a real Windows machine: it starts a native .exe.
const EXE_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*
`;

// The usual npm shim for a package whose bin is a JavaScript file.
const NODE_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\some-cli\\bin\\cli.js" %*
`;

const NODE = 'C:\\Program Files\\nodejs\\node.exe';

describe('parseCmdShim (S0-12)', () => {
  it('finds the .exe an npm shim starts', () => {
    expect(parseCmdShim(EXE_SHIM, 'C:\\npm', NODE)).toEqual({
      file: path.join('C:\\npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
      args: [],
    });
  });

  it('finds the script and uses node for a JavaScript shim', () => {
    expect(parseCmdShim(NODE_SHIM, 'C:\\npm', NODE)).toEqual({
      file: NODE,
      args: [path.join('C:\\npm', 'node_modules', 'some-cli', 'bin', 'cli.js')],
    });
  });

  it('gives up on a shim it does not understand', () => {
    expect(parseCmdShim('@echo off\r\nsome-other-launcher %*\r\n', 'C:\\npm', NODE)).toBeUndefined();
    expect(parseCmdShim('', 'C:\\npm', NODE)).toBeUndefined();
  });
});

describe('resolveWindowsCommand (S0-12)', () => {
  /** A folder on a fake PATH. The resolver takes the separator and the node path as inputs so this runs anywhere. */
  function folder(files: Record<string, string>) {
    const dir = mkdtempSync(path.join(tmpdir(), 'conclave-shim-'));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text);
    }
    return dir;
  }
  const opts = (dir: string) => ({ sep: ';', nodeExe: NODE, env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' } });

  it('uses a real .exe directly, with no shell', () => {
    const dir = folder({ 'tool.exe': 'MZ' });
    expect(resolveWindowsCommand({ command: 'tool' }, opts(dir))).toEqual({ file: path.join(dir, 'tool.exe'), args: [], shell: false });
  });

  it('turns a .cmd shim that starts an .exe into that .exe, with no shell', () => {
    const dir = folder({ 'tool.cmd': EXE_SHIM, 'node_modules/opencode-ai/bin/opencode.exe': 'MZ' });
    expect(resolveWindowsCommand({ command: 'tool', prefixArgs: ['run'] }, opts(dir))).toEqual({
      file: path.join(dir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
      args: ['run'],
      shell: false,
    });
  });

  it('turns a .cmd shim that starts a script into node plus the script, with no shell', () => {
    const dir = folder({ 'tool.cmd': NODE_SHIM, 'node_modules/some-cli/bin/cli.js': '//' });
    expect(resolveWindowsCommand({ command: 'tool' }, opts(dir))).toEqual({
      file: NODE,
      args: [path.join(dir, 'node_modules', 'some-cli', 'bin', 'cli.js')],
      shell: false,
    });
  });

  it('falls back to a shell for a .cmd it cannot read, and for a command it cannot find', () => {
    const odd = folder({ 'tool.cmd': '@echo off\r\nother %*\r\n' });
    expect(resolveWindowsCommand({ command: 'tool' }, opts(odd))).toMatchObject({ file: path.join(odd, 'tool.cmd'), shell: true });
    expect(resolveWindowsCommand({ command: 'nothing-here' }, opts(odd))).toMatchObject({ file: 'nothing-here', shell: true });
  });

  it('leaves an absolute path alone', () => {
    expect(resolveWindowsCommand({ command: 'C:\\x\\tool.exe' }, opts('C:\\none'))).toEqual({ file: 'C:\\x\\tool.exe', args: [], shell: false });
  });
});

describe('killing a run (S0-12)', () => {
  it('uses taskkill with /T /F on Windows, so the child\'s own children die too', () => {
    expect(killCommand('win32', 4242)).toEqual({ file: 'taskkill', args: ['/pid', '4242', '/T', '/F'] });
  });

  it('uses the child handle on other platforms', () => {
    expect(killCommand('linux', 4242)).toBeUndefined();
    expect(killCommand('darwin', 4242)).toBeUndefined();
  });
});

describe('quoting for cmd.exe (S0-12)', () => {
  it('quotes what needs it and nothing else', () => {
    expect(quoteForCmd('--version')).toBe('--version');
    expect(quoteForCmd('C:\\Program Files\\tool.cmd')).toBe('"C:\\Program Files\\tool.cmd"');
    expect(quoteForCmd('a"b')).toBe('"a""b"');
    expect(quoteForCmd('a&b')).toBe('"a&b"');
  });

  it('quotes the file and every argument the same way for health() and start()', () => {
    const shelled = { file: 'C:\\Program Files\\tool.cmd', args: ['run'], shell: true };
    expect(spawnArgs(shelled, ['--version'])).toEqual({ file: '"C:\\Program Files\\tool.cmd"', args: ['run', '--version'] });
    const direct = { file: 'C:\\Program Files\\tool.exe', args: ['run'], shell: false };
    expect(spawnArgs(direct, ['--version'])).toEqual({ file: 'C:\\Program Files\\tool.exe', args: ['run', '--version'] });
  });
});

describe.skipIf(process.platform !== 'win32')('cancel kills the whole tree on Windows (S0-12, by machine)', () => {
  const tree = path.join(__dirname, 'fixtures', 'fake-tree.mjs');

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('leaves no grandchild process after a cancelled run', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'conclave-tree-'));
    const pidFile = path.join(dir, 'grandchild.pid');
    const runtime = createCliRuntime('claude-cli', {
      command: { command: process.execPath, prefixArgs: [tree, pidFile] },
      baseEnv: process.env,
    });
    const req: RunRequest = {
      runId: 'run-tree',
      workspaceId: 'ws',
      agentId: 'agent',
      agentKey: 'researcher',
      instructions: 'x',
      taskInput: 'x',
      workspaceDir: dir,
      modelAlias: 'researcher',
      maxTurns: 5,
      runToken: 'tok_tree',
    };
    const events: RunEvent[] = [];
    const running = (async () => {
      for await (const e of runtime.start(req)) events.push(e);
    })();

    let grandchild = 0;
    for (let i = 0; i < 100 && !grandchild; i++) {
      await new Promise((r) => setTimeout(r, 100));
      grandchild = Number(await readFile(pidFile, 'utf8').catch(() => '0'));
    }
    expect(grandchild, 'the fake CLI started a grandchild').toBeGreaterThan(0);
    expect(alive(grandchild)).toBe(true);

    await runtime.cancel(req.runId);
    await running;
    expect(events[events.length - 1]).toMatchObject({ type: 'error', kind: 'cancelled' });

    for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(grandchild), 'the grandchild is gone').toBe(false);
  }, 30_000);
});
