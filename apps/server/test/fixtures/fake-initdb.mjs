/* global process, setInterval */
// A stand-in for initdb. Usage: node fake-initdb.mjs <control-dir> <mode> --pgdata=... --pwfile=... [other initdb flags]
// Modes: ok, hang-then-ok (hangs on the first call, like the real one sometimes does), hang, fail.
// It records what it was called with in <control-dir> so the test can check it.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [control, mode, ...rest] = process.argv.slice(2);
const arg = (name) => rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const pgdata = arg('pgdata');
const pwfile = arg('pwfile');

appendFileSync(path.join(control, 'calls.log'), `${rest.join(' ')}\n`);
if (pwfile && existsSync(pwfile)) writeFileSync(path.join(control, 'pwfile-path.txt'), pwfile + '\n' + readFileSync(pwfile, 'utf8'));
const calls = readFileSync(path.join(control, 'calls.log'), 'utf8').trim().split('\n').length;

function hang() {
  // Like the real initdb, it has a child of its own (the bootstrap process) that is also stuck.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(path.join(control, `grandchild-${calls}.pid`), String(child.pid));
  mkdirSync(pgdata, { recursive: true });
  writeFileSync(path.join(pgdata, 'partial-from-hung-attempt'), 'x');
  setInterval(() => undefined, 1000);
}

if (mode === 'fail') {
  process.stderr.write('initdb: error: could not create directory: boom\n');
  process.exit(1);
} else if (mode === 'hang' || (mode === 'hang-then-ok' && calls === 1)) {
  hang();
} else {
  // A successful attempt starts from a clean directory: the half-made one must have been removed.
  if (existsSync(path.join(pgdata, 'partial-from-hung-attempt'))) {
    process.stderr.write('initdb: directory was not cleaned after the hung attempt\n');
    process.exit(3);
  }
  mkdirSync(pgdata, { recursive: true });
  writeFileSync(path.join(pgdata, 'PG_VERSION'), '18\n');
  process.exit(0);
}
