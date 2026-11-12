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

/** Where the server listens, and whether a login is needed (CLAUDE.md rule 9, SPEC 12). */
export interface AuthConfig {
  /** Every request needs a signed-in owner. Always true when the server listens beyond loopback. */
  login: boolean;
  /** The interface the server listens on. Loopback unless BIND_HOST says otherwise. */
  host: string;
  /** Cookies carry the Secure flag. True as soon as the server listens beyond loopback. */
  secureCookies: boolean;
  /** Where the web app is served; the browser sends passkey requests from here. */
  webOrigin: string;
  /** Where the browser reaches this server. */
  apiOrigin: string;
  /** The passkey identity: a domain name, never an IP address. */
  rpID: string;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
export const isLoopback = (host: string) => LOOPBACK.has(host.trim().toLowerCase());

/**
 * One place decides it. The server listens on loopback with no login by default. Any other interface needs the login
 * wall on and an https address for the web app, and the wall cannot be turned off while such an interface is set: this
 * throws instead, so the server never starts open to the network. Locally, passkeys need the name `localhost` (an IP
 * address cannot be a passkey identity), so the local defaults use it.
 */
export function resolveAuthConfig(env: Env = process.env): AuthConfig {
  const host = (env.BIND_HOST ?? '').trim() || HOST;
  const loopback = isLoopback(host);
  const flag = (env.LOGIN ?? '').trim().toLowerCase();
  const login = flag === 'on' || flag === 'true' || flag === '1';
  if (!loopback && !login) {
    throw new Error(`BIND_HOST is ${host}, which is not loopback, so login is required. Set LOGIN=on (and PUBLIC_WEB_ORIGIN to the https address you will use). The server will not listen on the network without it.`);
  }
  const port = resolvePort(env);
  const webOrigin = (env.PUBLIC_WEB_ORIGIN ?? '').trim().replace(/\/$/, '');
  if (!loopback) {
    if (!webOrigin) throw new Error('PUBLIC_WEB_ORIGIN is not set. A server that listens beyond loopback needs the https address of the web app, for example https://my-laptop.tailnet.ts.net.');
    if (!webOrigin.startsWith('https://')) throw new Error(`PUBLIC_WEB_ORIGIN (${webOrigin}) must be https when the server listens beyond loopback, because passkeys and Secure cookies need it.`);
  }
  const web = webOrigin || 'http://localhost:3000';
  const api = (env.PUBLIC_API_ORIGIN ?? '').trim().replace(/\/$/, '') || (loopback ? `http://localhost:${port}` : web.replace(/^(https:\/\/[^/:]+).*$/, '$1') + `:${port}`);
  return { login, host, secureCookies: !loopback || web.startsWith('https://'), webOrigin: web, apiOrigin: api, rpID: new URL(web).hostname };
}
