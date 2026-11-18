import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { runTests } from './pr';

const run = promisify(execFile);

export class DeployError extends Error {}

export interface Deployer {
  readonly name: string;
  /** Builds the base branch of a pushed project in a fresh copy and serves it. Throws a DeployError with the reason if it cannot. */
  deploy(i: { id: string; projectKey: string; base: string; buildCmd: string | null }): Promise<{ ref: string; url: string }>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);

/**
 * The stand-in for Vercel (S7-8): clones the project's remote, runs its build command in that copy (clean environment, no server secret),
 * and serves the output (`dist` if the build made one, else the copy itself) on 127.0.0.1 only, on a port the system picks. Nothing leaves
 * the machine. The previews live as long as the server does.
 */
export class LocalDeployer implements Deployer {
  readonly name = 'local';
  private readonly servers: Server[] = [];
  constructor(
    private readonly remotesRoot: string,
    private readonly deploysRoot: string,
  ) {}

  async deploy(i: { id: string; projectKey: string; base: string; buildCmd: string | null }): Promise<{ ref: string; url: string }> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(i.projectKey) || !/^[A-Za-z0-9._/-]+$/.test(i.base) || i.base.startsWith('-')) throw new DeployError('Bad project or branch name.');
    const bare = path.join(this.remotesRoot, `${i.projectKey}.git`);
    if (!(await isDir(bare))) throw new DeployError(`"${i.projectKey}" has not been pushed to its remote yet, so there is nothing to deploy.`);
    const dir = path.join(this.deploysRoot, i.id);
    await mkdir(this.deploysRoot, { recursive: true });
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? process.env.USERPROFILE ?? '', GIT_TERMINAL_PROMPT: '0', LANG: 'C' };
    try {
      await run('git', ['clone', '-q', '--branch', i.base, bare, dir], { env, timeout: 120_000 });
    } catch {
      throw new DeployError(`The remote has no "${i.base}" branch to deploy.`);
    }
    const ref = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir, env })).stdout.trim();
    if (i.buildCmd) {
      const built = await runTests(dir, i.buildCmd);
      if (!built.ok) throw new DeployError(`The build failed${built.timedOut ? ' (it timed out)' : ''}:\n${built.output}`);
    }
    const out = path.join(dir, 'dist');
    const root = (await isDir(out)) ? out : dir;
    return { ref, url: await this.serve(root) };
  }

  private serve(root: string): Promise<string> {
    const server = createServer((req, res) => {
      void (async () => {
        let rel: string;
        try {
          rel = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        } catch {
          rel = '/';
        }
        let file = path.resolve(root, `.${path.posix.normalize(rel)}`);
        const inside = file === root || file.startsWith(root + path.sep);
        const hidden = path.relative(root, file).split(path.sep).some((part) => part.startsWith('.'));
        if (!inside || hidden) return void res.writeHead(404).end('Not found');
        if (await isDir(file)) file = path.join(file, 'index.html');
        const ok = await stat(file).then((s) => s.isFile(), () => false);
        if (!ok) return void res.writeHead(404).end('Not found');
        res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
        createReadStream(file).pipe(res);
      })();
    });
    this.servers.push(server);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`);
      });
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    this.servers.length = 0;
  }
}
