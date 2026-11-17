import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { REPO_ROOT } from '../config';

const run = promisify(execFile);

export class ProjectError extends Error {}

export const PROJECT_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_CMD = 500;

/**
 * Git, run with a clean environment: only what it needs to find itself, and no prompts. A project folder can hold anything, so this
 * never runs a command from inside it other than git itself, and never one stored on the project.
 */
const git = async (cwd: string, ...args: string[]): Promise<string> => {
  const { stdout } = await run('git', args, { cwd, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? process.env.USERPROFILE ?? '', GIT_TERMINAL_PROMPT: '0', LANG: 'C' }, timeout: 15_000 });
  return stdout.trim();
};

const sameOrInside = (inner: string, outer: string): boolean => {
  const rel = path.relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

export interface NewProject {
  key: string;
  path: string;
  defaultBranch?: string;
  testCmd?: string | null;
  buildCmd?: string | null;
}
export interface CheckedProject {
  key: string;
  path: string;
  defaultBranch: string;
  testCmd: string | null;
  buildCmd: string | null;
}

const command = (label: string, v: string | null | undefined): string | null => {
  if (v === undefined || v === null || v.trim() === '') return null;
  // eslint-disable-next-line no-control-regex
  if (/[\r\n\u0000]/.test(v)) throw new ProjectError(`The ${label} command must be one line.`);
  if (v.length > MAX_CMD) throw new ProjectError(`The ${label} command is too long (${MAX_CMD} characters at most).`);
  return v.trim();
};

/**
 * Checks a project before it is stored (S7-1): a plain key, a full path to the top of a git repository that is not this one and not
 * inside it, a branch that exists, and commands that are one short line each. The commands are kept as given and are not run here.
 */
export async function checkProject(p: NewProject): Promise<CheckedProject> {
  if (!PROJECT_KEY.test(p.key)) throw new ProjectError('The key must be lower-case letters, digits and dashes, up to 40 characters.');
  if (!path.isAbsolute(p.path)) throw new ProjectError('Give the full path to the folder.');
  let real: string;
  try {
    real = await realpath(p.path);
    if (!(await stat(real)).isDirectory()) throw new Error('not a folder');
  } catch {
    throw new ProjectError('That folder is not there.');
  }
  // Never this repository, and never anything inside it: an agent working there could read or change the OS itself.
  const self = await realpath(REPO_ROOT).catch(() => REPO_ROOT);
  if (sameOrInside(real, self)) throw new ProjectError('That is inside the Conclave repository. A project must be a different folder.');
  let top: string;
  try {
    top = await realpath(await git(real, 'rev-parse', '--show-toplevel'));
  } catch {
    throw new ProjectError('That folder is not a git repository. Run git init in it first.');
  }
  if (path.resolve(top).toLowerCase() !== path.resolve(real).toLowerCase()) throw new ProjectError('Give the top of the repository, not a folder inside it.');
  let branch = p.defaultBranch?.trim();
  if (branch) {
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch)) throw new ProjectError('That is not a branch name.');
    try {
      await git(real, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
    } catch {
      throw new ProjectError(`The repository has no branch called "${branch}".`);
    }
  } else {
    try {
      branch = await git(real, 'symbolic-ref', '--short', 'HEAD');
    } catch {
      throw new ProjectError('The repository has no branch checked out and no commits yet. Make a first commit, or name a branch.');
    }
  }
  return { key: p.key, path: real, defaultBranch: branch, testCmd: command('test', p.testCmd), buildCmd: command('build', p.buildCmd) };
}
