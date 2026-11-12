/* global process, console, setTimeout, clearTimeout, setInterval, clearInterval */
// `pnpm dev`: starts the server and the web app, prefixes their output, and stops both together.
//
// Why not `pnpm -r --parallel dev`: on Windows it hands every child a stdin pipe that nobody writes to or
// closes, and the server then never starts. It sat silent at 0% CPU in 7 of 7 tries with `-r --parallel`, and
// started in 17 s every time with its stdin closed. So each process here gets stdin closed ('ignore').
import { execSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const DEFAULT = [
  { name: 'server', command: 'pnpm --filter @conclave/server dev' },
  { name: 'web', command: 'pnpm --filter @conclave/web dev' },
];
// Tests replace the commands with fakes.
const commands = process.env.CONCLAVE_DEV_COMMANDS ? JSON.parse(process.env.CONCLAVE_DEV_COMMANDS) : DEFAULT;
const width = Math.max(...commands.map((c) => c.name.length));
const windows = process.platform === 'win32';

/** How long the processes get to shut down after Ctrl+C before they are stopped by force. The server stops Postgres cleanly. */
const GRACE_MS = 20_000;

const children = commands.map(({ name, command }) => {
  // One command string, not an argument list: Node warns about handing a shell an argument list (DEP0190).
  const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const prefix = `${name.padEnd(width)} | `;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(prefix + line));
  }
  return { name, child, exited: false };
});

let stopping = false;
let exitCode = null;

function stopAll(signal) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exited) continue;
    // A terminal's Ctrl+C already reached them. Elsewhere, ask politely.
    if (signal && !windows) c.child.kill('SIGINT');
  }
  const force = setTimeout(() => {
    for (const c of children) {
      if (c.exited) continue;
      try {
        if (windows) execSync(`taskkill /PID ${c.child.pid} /T /F`, { stdio: 'ignore' });
        else c.child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
  }, signal ? GRACE_MS : 0);
  force.unref?.();
  // Poll until everything is down, then leave with the code of whatever ended first.
  const wait = setInterval(() => {
    if (children.every((c) => c.exited)) {
      clearInterval(wait);
      clearTimeout(force);
      process.exit(exitCode ?? 0);
    }
  }, 100);
}

for (const c of children) {
  c.child.on('close', (code) => {
    c.exited = true;
    if (!stopping) {
      exitCode = code ?? 1;
      console.log(`${c.name} exited with code ${code}`);
      stopAll(null);
    }
  });
}

process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
