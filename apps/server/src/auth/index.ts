import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { setSessionCookie } from 'better-auth/cookies';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { z } from 'zod';
import type { AuthConfig } from '../config';
import * as authSchema from '../db/auth-schema';
import { withWorkspace } from '../db/tenant';

const CODE_TTL_MS = 15 * 60_000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const OWNER_EMAIL = 'owner@conclave.local';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O or U

export const SETUP_CODE_FILE = 'owner-setup-code.txt';

const normalise = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '');
const hash = (code: string) => createHash('sha256').update(normalise(code)).digest('hex');

function newCode(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 32];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export interface SessionInfo {
  userId: string;
  sessionId: string;
}

export interface Device {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/**
 * Sign-in for the one owner (SPEC 11 Auth, 12; Better Auth with passkeys).
 *
 * A passkey can only be added by someone who is already signed in, so the first sign-in needs another way in. That is
 * a one-time code: written to a file in the data folder for the person at the machine (never printed to a log), valid
 * for 15 minutes, used once, stored only as a hash. A signed-in owner can make another code for a new device. Wrong
 * guesses are counted and enrolment locks after ten.
 */
export function createAuth(o: { pool: pg.Pool; workspaceId: string; config: AuthConfig; dataDir: string; secret: string }) {
  const { pool, workspaceId, config, dataDir } = o;
  const db = drizzle(pool, { schema: authSchema });
  const failures: number[] = [];

  const ownerId = async (): Promise<string | null> => {
    const r = await withWorkspace(pool, workspaceId, ({ client }) => client.query<{ user_id: string }>("select user_id from members where role = 'owner' limit 1"));
    return r.rows[0]?.user_id ?? null;
  };
  const setupFile = path.join(dataDir, SETUP_CODE_FILE);

  async function issueEnrolCode(forUserId?: string): Promise<string> {
    if (!forUserId && (await ownerId())) throw new Error('An owner already exists. Sign in and make a code for the new device from there.');
    if (!forUserId) await pool.query('delete from auth.enrol_code where user_id is null and used_at is null'); // only the newest first-owner code is valid
    const code = newCode();
    await pool.query('insert into auth.enrol_code (id, code_hash, user_id, expires_at) values ($1, $2, $3, $4)', [randomUUID(), hash(code), forUserId ?? null, new Date(Date.now() + CODE_TTL_MS)]);
    return code;
  }

  const ownerEnrol = {
    id: 'owner-enrol',
    endpoints: {
      enrolOwner: createAuthEndpoint('/owner/enrol', { method: 'POST', body: z.object({ code: z.string().min(1).max(64) }) }, async (ctx) => {
        const now = Date.now();
        while (failures.length && now - failures[0]! > FAILURE_WINDOW_MS) failures.shift();
        if (failures.length >= MAX_FAILURES) throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many wrong codes. Try again later.' });

        // One statement claims the code, so two requests cannot both use it.
        const claimed = await pool.query<{ user_id: string | null }>(
          'update auth.enrol_code set used_at = now() where code_hash = $1 and used_at is null and expires_at > now() returning user_id',
          [hash(ctx.body.code)],
        );
        const row = claimed.rows[0];
        if (!row) {
          failures.push(now);
          throw new APIError('UNAUTHORIZED', { message: 'That code did not work.' });
        }

        let userId = row.user_id;
        if (!userId) {
          if (await ownerId()) throw new APIError('UNAUTHORIZED', { message: 'That code did not work.' });
          const created = await ctx.context.internalAdapter.createUser({ email: OWNER_EMAIL, name: 'Owner', emailVerified: true }, { method: 'owner-enrol' });
          userId = created.id;
          await withWorkspace(pool, workspaceId, ({ client }) => client.query("insert into members (workspace_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing", [workspaceId, userId]));
          rmSync(setupFile, { force: true });
        }
        const user = await ctx.context.internalAdapter.findUserById(userId);
        if (!user) throw new APIError('UNAUTHORIZED', { message: 'That code did not work.' });
        const session = await ctx.context.internalAdapter.createSession(user.id);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ ok: true });
      }),
    },
  } as const;

  const auth = betterAuth({
    appName: 'Conclave OS',
    baseURL: config.apiOrigin,
    basePath: '/api/auth',
    secret: o.secret,
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    trustedOrigins: [config.webOrigin, config.apiOrigin],
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    advanced: {
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: config.secureCookies },
    },
    plugins: [passkey({ rpID: config.rpID, rpName: 'Conclave OS', origin: config.webOrigin }), ownerEnrol],
  });

  async function session(headers: Headers): Promise<SessionInfo | null> {
    const s = await auth.api.getSession({ headers });
    return s ? { userId: s.user.id, sessionId: s.session.id } : null;
  }

  return {
    config,
    handler: (req: Request) => auth.handler(req),
    session,
    ownerId,
    issueEnrolCode,
    /** Makes sure a person at the machine can set up the first owner: writes a fresh code to a file, or reports there is nothing to do. */
    async ensureSetupCode(): Promise<{ file: string | null }> {
      if (await ownerId()) {
        rmSync(setupFile, { force: true });
        return { file: null };
      }
      const code = await issueEnrolCode();
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(setupFile, `${code}\n`, { mode: 0o600 });
      try {
        chmodSync(setupFile, 0o600);
      } catch {
        // Windows has no POSIX modes; the data folder is the person's own.
      }
      return { file: setupFile };
    },
    async devices(current: SessionInfo): Promise<Device[]> {
      const r = await pool.query<{ id: string; user_agent: string | null; ip_address: string | null; created_at: Date; expires_at: Date }>(
        'select id, user_agent, ip_address, created_at, expires_at from auth.session where user_id = $1 and expires_at > now() order by created_at desc',
        [current.userId],
      );
      return r.rows.map((d) => ({ id: d.id, userAgent: d.user_agent, ipAddress: d.ip_address, createdAt: d.created_at.toISOString(), expiresAt: d.expires_at.toISOString(), current: d.id === current.sessionId }));
    },
    async revokeDevice(userId: string, sessionId: string): Promise<boolean> {
      const r = await pool.query('delete from auth.session where id = $1 and user_id = $2', [sessionId, userId]);
      return (r.rowCount ?? 0) > 0;
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;

/** The secret that signs cookies: AUTH_SECRET if set, else one made on first use and kept in the data folder. */
export function resolveAuthSecret(env: Record<string, string | undefined>, dataDir: string): string {
  const fromEnv = (env.AUTH_SECRET ?? '').trim();
  if (fromEnv.length >= 32) return fromEnv;
  const file = path.join(dataDir, 'secrets', 'auth-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(path.dirname(file), { recursive: true });
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}
