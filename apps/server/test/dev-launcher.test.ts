import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const launcher = path.resolve(__dirname, '..', '..', '..', 'scripts', 'dev.mjs');

/** A child that reports what its stdin is, says hello, and stays alive until told to stop (or until it exits by itself). */
function fakeChild(dir: string, name: string, behaviour: 'stay' | 'exit-3') {
  const file = path.join(dir, `${name}.mjs`);
  writeFileSync(
    file,
    `
    let ended = false;
    process.stdin.on('end', () => { ended = true; console.log('${name}: stdin closed'); });
    process.stdin.resume();
    console.log('${name}: hello');
    setTimeout(() => { if (!ended) console.log('${name}: stdin STILL OPEN after 1s'); }, 1000);
    ${behaviour === 'exit-3' ? "setTimeout(() => process.exit(3), 1500);" : "setInterval(() => {}, 1000);"}
    `,
  );
  return { name, command: `"${process.execPath}" "${file}"` };
}

function run(commands: unknown[], stopAfterMs?: number) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(process.execPath, [launcher], {
      env: { ...process.env, CONCLAVE_DEV_COMMANDS: JSON.stringify(commands) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', (code) => resolve({ code, out }));
    if (stopAfterMs) setTimeout(() => child.kill(), stopAfterMs);
  });
}

describe('pnpm dev launcher', () => {
  it('starts every process with its stdin closed, so none waits on input that never comes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'conclave-dev-'));
    const { out } = await run([fakeChild(dir, 'server', 'exit-3'), fakeChild(dir, 'web', 'stay')]);
    expect(out).toContain('server: stdin closed');
    expect(out).toContain('web: stdin closed');
    expect(out).not.toContain('STILL OPEN');
  }, 30_000);

  it('prefixes every line with the name of the process it came from', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'conclave-dev-'));
    const { out } = await run([fakeChild(dir, 'server', 'exit-3'), fakeChild(dir, 'web', 'stay')]);
    expect(out).toMatch(/^server\s*\| server: hello$/m);
    expect(out).toMatch(/^web\s*\| web: hello$/m);
  }, 30_000);

  it('stops the others and exits with the failing code when one process exits', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'conclave-dev-'));
    const started = Date.now();
    const { code, out } = await run([fakeChild(dir, 'server', 'exit-3'), fakeChild(dir, 'web', 'stay')]);
    expect(code).toBe(3);
    expect(out).toMatch(/server exited with code 3/);
    expect(Date.now() - started).toBeLessThan(20_000); // `web` never exits by itself, so it was stopped
  }, 30_000);

  it('runs the real server and web app by default', async () => {
    const text = (await import('node:fs')).readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8');
    expect(JSON.parse(text).scripts.dev).toBe('node scripts/dev.mjs');
    const src = (await import('node:fs')).readFileSync(launcher, 'utf8');
    expect(src).toContain('@conclave/server');
    expect(src).toContain('@conclave/web');
    // The comments explain why; only the code must stay clear of `pnpm -r --parallel`.
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/--parallel/);
  });
});
