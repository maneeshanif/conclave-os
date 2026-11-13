import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { isPostPlatform, type PostPlatform } from '../posts';

/**
 * Browser profiles (SPEC 8, 12). A signed-in browser is how a post goes out where there is no posting API. Its login lives in a
 * profile folder in the data folder, made by a person logging in by hand once; the OS never sees a password, only the folder
 * the browser keeps. A profile is never inside the repo.
 */
export function profileDir(dataDir: string, accountId: string): string {
  // The id becomes a folder name and nothing else: no separators, no dots, no way out of browser-profiles/.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) throw new Error(`"${accountId}" is not a valid account id.`);
  return path.join(dataDir, 'browser-profiles', accountId);
}

/** Where a person logs in, per platform. */
export const LOGIN_URLS: Record<PostPlatform, string> = {
  x: 'https://x.com/i/flow/login',
  linkedin: 'https://www.linkedin.com/login',
  instagram: 'https://www.instagram.com/accounts/login/',
};

/** Opens a visible browser on a profile folder. The Playwright implementation is in ./playwright.ts; tests pass a fake. */
export interface LoginLauncher {
  open(dir: string, loginUrl: string): Promise<void>;
  /** Resolves when the person has closed the browser (or said they are done). */
  waitUntilClosed(): Promise<void>;
}

/**
 * Records a session as valid or expired. Expired raises one action item per account (however often it is marked); valid closes it.
 * Called by the login command, by the person in the app, and by the executor when the browser finds the login gone.
 */
export async function markSession(c: pg.PoolClient, ws: string, accountId: string, state: 'valid' | 'expired', by: string): Promise<boolean> {
  const a = await c.query<{ handle: string }>('update channel_accounts set session_state = $2, session_checked_at = now() where id = $1 returning handle', [accountId, state]);
  if (!a.rows[0]) return false;
  const marker = `account: ${accountId}\n`;
  if (state === 'expired') {
    const open = await c.query("select 1 from action_items where kind = 'session_expired' and status = 'open' and body like $1", [`${marker}%`]);
    if (!open.rows.length) {
      await c.query("insert into action_items (workspace_id, kind, title, body) values ($1, 'session_expired', $2, $3)", [
        ws,
        `The login for ${a.rows[0].handle} has expired`,
        `${marker}Log in to ${a.rows[0].handle} again with: pnpm run browser:login ${a.rows[0].handle}\nNothing was posted. Approved posts wait and go out once you have logged in again.`,
      ]);
    }
  } else {
    await c.query("update action_items set status = 'done', resolved_at = now(), resolved_by = $2, resolution_note = 'Logged in again.' where kind = 'session_expired' and status = 'open' and body like $1", [`${marker}%`, by]);
  }
  await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'account.session', $3, $4)", [ws, by, accountId, JSON.stringify({ state })]);
  return true;
}

/**
 * `pnpm run browser:login <account>`: opens a visible browser on the account's profile folder at the platform's login page and
 * waits for the person to log in and close it. Then the account has a profile and a valid session. Logging in does not switch
 * the account to the browser: that is a separate, deliberate step.
 */
export async function loginAccount(pool: pg.Pool, ws: string, dataDir: string, ref: string, launcher: LoginLauncher): Promise<{ id: string; handle: string; dir: string }> {
  const acct = await withWorkspace(pool, ws, async ({ client: c }) => (await c.query<{ id: string; channel: string; handle: string }>('select id, channel, handle from channel_accounts where id::text = $1 or lower(handle) = lower($1) limit 1', [ref])).rows[0]);
  if (!acct) throw new Error(`There is no account called "${ref}". List them with: GET /api/browser/accounts`);
  if (!isPostPlatform(acct.channel)) throw new Error(`${acct.handle} is not a posting account (it is for ${acct.channel}), so there is nothing to log in to.`);
  const dir = profileDir(dataDir, acct.id);
  await mkdir(path.dirname(dir), { recursive: true });
  await launcher.open(dir, LOGIN_URLS[acct.channel]);
  await launcher.waitUntilClosed();
  await withWorkspace(pool, ws, async ({ client: c }) => {
    await c.query('update channel_accounts set browser_profile = $2 where id = $1', [acct.id, acct.id]);
    await markSession(c, ws, acct.id, 'valid', 'founder');
  });
  return { id: acct.id, handle: acct.handle, dir };
}
