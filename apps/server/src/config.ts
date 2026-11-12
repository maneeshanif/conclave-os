import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

/** The server answers on loopback only. No login exists before slice 1 (CLAUDE.md rule 9). */
export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 3100;
export const DEFAULT_PG_PORT = 54329;

/** This repository's root: apps/server/src -> three levels up. */
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

type Env = Record<string, string | undefined>;

const PortSchema = z.coerce.number().int().min(1).max(65535);

function portFrom(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  return PortSchema.parse(raw.trim());
}

export function resolvePort(env: Env = process.env): number {
  return portFrom(env.PORT, DEFAULT_PORT);
}

/** Embedded Postgres port. It listens on 127.0.0.1 only. */
export function resolvePgPort(env: Env = process.env): number {
  return portFrom(env.PG_PORT, DEFAULT_PG_PORT);
}

/**
 * Where the database, files and every agent's working folder live. It must be outside this repo:
 * Claude Code reads CLAUDE.md from parent folders, and a company agent must not load ours (SPEC 13).
 */
export function resolveDataDir(env: Env = process.env): string {
  const raw = (env.DATA_DIR ?? '').trim();
  let dir: string;
  if (raw === '') dir = join(homedir(), '.conclave-os');
  else if (raw === '~') dir = homedir();
  else if (raw.startsWith('~/') || raw.startsWith('~\\')) dir = join(homedir(), raw.slice(2));
  else dir = resolve(raw);

  const rel = relative(REPO_ROOT, dir);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(`DATA_DIR (${dir}) is inside the repo (${REPO_ROOT}). Put it outside, for example ~/.conclave-os.`);
  }
  return dir;
}
