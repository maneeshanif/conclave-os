/* global process, setInterval */
// A fake CLI that starts its own long-lived child, the way a real agent CLI starts tools.
// Used to check that cancelling a run kills the whole tree, not just the process we started.
// argv[2] is the file the grandchild's pid is written to.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(process.argv[2], String(grandchild.pid));
setInterval(() => undefined, 1000);
