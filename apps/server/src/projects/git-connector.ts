import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Git with a clean environment and no prompts: no credential helper can ask for, or hand over, a secret. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? process.env.USERPROFILE ?? '', GIT_TERMINAL_PROMPT: '0', LANG: 'C' };
  return (await run('git', args, { cwd, env, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 })).stdout.trim();
}

export interface PushInput {
  projectKey: string;
  /** The project's own repository, where the task's branch lives. */
  projectPath: string;
  branch: string;
}
export interface PrInput extends PushInput {
  base: string;
  title: string;
  summary: string;
  /** The next pull request number for this project (the local stand-in numbers its own). */
  number: number;
}

/**
 * Where an approved change goes (S7-6). One interface, two implementations: a local bare repo that stands in for GitHub (the default,
 * and the only one tested), and `gh` behind a switch. The executor is the only caller, and only after an approval (CLAUDE.md rule 1).
 * Later tasks add repository creation, merge and deploy to this same interface (S7-7, S7-8).
 */
export interface GitConnector {
  readonly name: string;
  /** Puts the branch on the remote. Pushing the same commit twice is harmless. */
  push(i: PushInput): Promise<{ head: string }>;
  /** The commit the remote has for the branch, or null if it has none. Used after a restart to learn whether a push landed. */
  remoteHead(projectKey: string, branch: string): Promise<string | null>;
  /** Records a pull request for a pushed branch. Returns where to see it, if anywhere. */
  openPullRequest(i: PrInput): Promise<{ url: string | null }>;
}

const SAFE = /^[A-Za-z0-9._/-]+$/;
const badBranch = (b: string) => !SAFE.test(b) || b.startsWith('-');

/** The stand-in for GitHub: a bare repository per project under `root`. Nothing leaves the machine. */
export class LocalGitConnector implements GitConnector {
  readonly name = 'local';
  constructor(private readonly root: string) {}

  barePath(projectKey: string): string {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(projectKey)) throw new Error(`Bad project key "${projectKey}".`);
    return path.join(this.root, `${projectKey}.git`);
  }

  private async ensure(projectKey: string): Promise<string> {
    const bare = this.barePath(projectKey);
    const exists = await stat(bare).then(() => true, () => false);
    if (!exists) {
      await mkdir(bare, { recursive: true });
      await git(bare, 'init', '--bare', '-q');
    }
    return bare;
  }

  async push(i: PushInput): Promise<{ head: string }> {
    if (badBranch(i.branch)) throw new Error(`Bad branch name "${i.branch}".`);
    const bare = await this.ensure(i.projectKey);
    await git(i.projectPath, 'push', '-q', bare, `refs/heads/${i.branch}:refs/heads/${i.branch}`);
    return { head: await git(i.projectPath, 'rev-parse', `refs/heads/${i.branch}`) };
  }

  async remoteHead(projectKey: string, branch: string): Promise<string | null> {
    const bare = this.barePath(projectKey);
    if (!(await stat(bare).then(() => true, () => false))) return null;
    try {
      return await git(bare, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`);
    } catch {
      return null;
    }
  }

  async openPullRequest(): Promise<{ url: string | null }> {
    return { url: null }; // the record in code_pull_requests is the pull request
  }
}

/**
 * The real GitHub connector, through the `gh` command line. Written but not tested and not used unless switched on by name (S7-6): it
 * needs a signed-in `gh` and a remote, which is a person's step (docs/NEEDS-YOU.md). It runs with a clean environment, so it uses
 * `gh`'s own stored sign-in and nothing from this server.
 */
export class GhConnector implements GitConnector {
  readonly name = 'gh';
  async push(i: PushInput): Promise<{ head: string }> {
    if (badBranch(i.branch)) throw new Error(`Bad branch name "${i.branch}".`);
    await git(i.projectPath, 'push', '-q', 'origin', `refs/heads/${i.branch}:refs/heads/${i.branch}`);
    return { head: await git(i.projectPath, 'rev-parse', `refs/heads/${i.branch}`) };
  }
  async remoteHead(): Promise<string | null> {
    return null; // not known without asking the remote; after a restart the push is treated as unknown
  }
  async openPullRequest(i: PrInput): Promise<{ url: string | null }> {
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? process.env.USERPROFILE ?? '' };
    const out = await run('gh', ['pr', 'create', '--head', i.branch, '--base', i.base, '--title', i.title, '--body', i.summary], { cwd: i.projectPath, env, timeout: 120_000 });
    return { url: out.stdout.trim().split('\n').pop() || null };
  }
}

/** `local` (the default) or `gh`. Any other name is refused, so a typo cannot quietly pick the wrong one. */
export function selectGitConnector(name: string | undefined, localRoot: string): GitConnector {
  if (name === undefined || name === '' || name === 'local') return new LocalGitConnector(localRoot);
  if (name === 'gh') return new GhConnector();
  throw new Error(`Unknown git connector "${name}". Use "local" or "gh".`);
}
