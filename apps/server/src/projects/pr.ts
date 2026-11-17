import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { cleanEnv } from '../runtimes/cli';

const run = promisify(execFile);

export class PrError extends Error {}

const TEST_TIMEOUT_MS = 10 * 60_000;
const TAIL = 2000;

/** Git, run with a clean environment and no prompts. */
const git = async (cwd: string, ...args: string[]): Promise<string> => {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? process.env.USERPROFILE ?? '', GIT_TERMINAL_PROMPT: '0', LANG: 'C' };
  return (await run('git', args, { cwd, env, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 })).stdout.trim();
};

/**
 * Runs a project's test command in its worktree, in the server, with a clean environment: only what a program needs to start, and no
 * server secret (CLAUDE.md rule 4). The agent cannot influence this: there is no way to say the tests passed, only to make them pass.
 */
export function runTests(cwd: string, command: string, timeoutMs = TEST_TIMEOUT_MS): Promise<{ ok: boolean; code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const env = cleanEnv(process.env, { CI: '1' });
    const child = spawn(command, { cwd, env, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    const add = (d: Buffer) => {
      out = (out + d.toString()).slice(-20_000);
    };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, output: `${out}\n${err.message}`.slice(-TAIL), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, output: out.trim().slice(-TAIL), timedOut });
    });
  });
}

export interface PrFacts {
  head: string;
  commits: { sha: string; subject: string }[];
  diffStat: string;
}

/** What is on the branch: refuses uncommitted work and an empty branch, so what is proposed is exactly what is committed. */
export async function branchFacts(worktree: string, base: string): Promise<PrFacts> {
  const dirty = (await git(worktree, 'status', '--porcelain')).split('\n').filter(Boolean);
  if (dirty.length) throw new PrError(`Commit your work first: ${dirty.length} file${dirty.length === 1 ? ' has' : 's have'} changes that are not committed. Only what is committed can be proposed.`);
  const ahead = Number(await git(worktree, 'rev-list', '--count', `${base}..HEAD`));
  if (!ahead) throw new PrError('Nothing to propose: the branch has no commits of its own yet.');
  const head = await git(worktree, 'rev-parse', 'HEAD');
  const log = await git(worktree, 'log', '--format=%H%x09%s', `${base}..HEAD`);
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, ...rest] = l.split('\t');
      return { sha: sha!, subject: rest.join('\t').slice(0, 200) };
    })
    .slice(0, 50);
  const diffStat = (await git(worktree, 'diff', '--stat', '--no-color', `${base}...HEAD`)).slice(0, 4000);
  return { head, commits, diffStat };
}
