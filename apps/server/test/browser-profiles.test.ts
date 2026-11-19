import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutors } from '../src/actions';
import { outboxPostTransport, SessionExpiredError, browserPostTransport, type BrowserDriver } from '../src/actions/post-transport';
import { OutboxTransport } from '../src/actions/transport';
import { createApp } from '../src/app';
import { loginAccount, profileDir, type LoginLauncher } from '../src/browser/profiles';
import { playwrightDriver, type DriverPage } from '../src/browser/driver';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { REPO_ROOT } from '../src/paths';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let app: ReturnType<typeof createApp>;
let store: DbOsStore;
let companyRoot = '';
let agentId = '';
let runId = '';
let taskId = '';
let xId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId, taskId });
const json = { 'content-type': 'application/json' };
const call = (method: string, p: string, body?: unknown) => app.request(`/api${p}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
const acct = async () => (await sql('select transport, browser_profile, session_state from channel_accounts where id = $1', [xId])).rows[0];
let n = 0;
async function approvedPost() {
  const r = await callOsTool(store, scope(), 'propose_post', { accountId: xId, text: `A post number ${++n} about booking pages.` });
  const id = /as ([0-9a-f-]{36})/.exec(r)![1]!;
  await sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);
  return id;
}
const executors = (browser?: BrowserDriver) =>
  createExecutors({
    pool: sys.app,
    workspaceId: ws(),
    transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')),
    companyRoot,
    from: 'a@b.test',
    postTransport: outboxPostTransport(sys.dataDir),
    ...(browser ? { browserPostTransport: browserPostTransport(sys.dataDir, browser) } : {}),
  });

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), dataDir: sys.dataDir } as never);
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-co-prof-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), '# Acme\n');
  store = new DbOsStore(sys.app, () => undefined, companyRoot);
  await agentNew(sys, { template: 'writer', department: 'marketing', id: 'prof-writer' });
  agentId = (await sql("select id from agents where key = 'prof-writer'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  taskId = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 'p', 'in_progress', $2, $2, 'founder') returning id", [ws(), agentId])).rows[0].id;
  runId = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId, taskId])).rows[0].id;
  xId = (await sql("insert into channel_accounts (workspace_id, channel, handle) values ($1, 'x', '@acme_test') returning id", [ws()])).rows[0].id;
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql("update channel_accounts set transport = 'outbox', browser_profile = null, session_state = 'none', health = 'ok'");
  await sql('delete from posts');
  await sql('delete from action_items where approval_id is not null');
  await sql("delete from action_items where kind = 'session_expired'");
  await sql("delete from approvals where kind = 'post.publish'");
});

describe('profile folders (S5-3)', () => {
  it('are inside the data folder, one per account, and never inside the repo', () => {
    const dir = profileDir(sys.dataDir, xId);
    expect(dir).toBe(path.join(sys.dataDir, 'browser-profiles', xId));
    expect(path.relative(REPO_ROOT, dir).startsWith('..')).toBe(true);
  });
  it('refuse an account id that could point somewhere else', () => {
    for (const bad of ['..', '../x', 'a/b', 'a\\b', '', 'C:\\x', '.']) expect(() => profileDir(sys.dataDir, bad), bad).toThrow(/not a valid account id/i);
  });
});

describe('the browser settings API (S5-3)', () => {
  it('lists each account with whether it has a profile, its session and its transport', async () => {
    const list = (await (await call('GET', '/browser/accounts')).json()) as { id: string; handle: string; transport: string; hasProfile: boolean; sessionState: string }[];
    expect(list.find((a) => a.id === xId)).toMatchObject({ handle: '@acme_test', transport: 'outbox', hasProfile: false, sessionState: 'none' });
  });

  it('refuses to switch an account to the browser until it has a profile and a valid session', async () => {
    const r = await call('POST', `/browser/accounts/${xId}/transport`, { transport: 'browser' });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/log in|no browser profile/i);
    await sql("update channel_accounts set browser_profile = $2 where id = $1", [xId, xId]);
    expect((await call('POST', `/browser/accounts/${xId}/transport`, { transport: 'browser' })).status).toBe(409); // profile but no valid session
    await sql("update channel_accounts set session_state = 'valid' where id = $1", [xId]);
    expect((await call('POST', `/browser/accounts/${xId}/transport`, { transport: 'browser' })).status).toBe(200);
    expect((await acct()).transport).toBe('browser');
    expect((await call('POST', `/browser/accounts/${xId}/transport`, { transport: 'outbox' })).status).toBe(200);
    expect((await acct()).transport).toBe('outbox');
  });

  it('refuses a transport it does not know, an unknown account, and does it all in the audit log', async () => {
    expect((await call('POST', `/browser/accounts/${xId}/transport`, { transport: 'carrier-pigeon' })).status).toBe(400);
    expect((await call('POST', '/browser/accounts/00000000-0000-4000-8000-000000000000/transport', { transport: 'outbox' })).status).toBe(404);
    await sql("update channel_accounts set browser_profile = $1, session_state = 'valid' where id = $1", [xId]);
    await call('POST', `/browser/accounts/${xId}/transport`, { transport: 'browser' });
    expect((await sql("select actor from audit_log where action = 'account.transport_changed'")).rows[0]).toMatchObject({ actor: 'founder' });
  });

  it('lets a person mark a session expired (and raises the item), or valid again (and closes it)', async () => {
    expect((await call('POST', `/browser/accounts/${xId}/session`, { state: 'expired' })).status).toBe(200);
    expect((await acct()).session_state).toBe('expired');
    expect((await sql("select count(*)::int as n from action_items where kind = 'session_expired' and status = 'open'")).rows[0].n).toBe(1);
    await call('POST', `/browser/accounts/${xId}/session`, { state: 'valid' });
    expect((await sql("select count(*)::int as n from action_items where kind = 'session_expired' and status = 'open'")).rows[0].n).toBe(0);
  });
});

describe('the executor and the account\'s transport (S5-3)', () => {
  const fakeDriver = (calls: unknown[]): BrowserDriver => ({ publish: async (a) => (calls.push(a), { finalUrl: 'https://x.test/s/1', screenshot: Buffer.from('p') }) });
  const asBrowser = () => sql("update channel_accounts set transport = 'browser', browser_profile = $1, session_state = 'valid' where id = $1", [xId]);

  it('publishes through the browser only for an account switched to it, and through the outbox otherwise', async () => {
    const calls: unknown[] = [];
    const ex = executors(fakeDriver(calls));
    const a = await approvedPost();
    expect(await ex.run(a)).toMatchObject({ status: 'executed' });
    expect(calls).toHaveLength(0);
    expect((await sql('select result from approvals where id = $1', [a])).rows[0].result.transport).toBe('outbox');
    await asBrowser();
    const b = await approvedPost();
    expect(await ex.run(b)).toMatchObject({ status: 'executed' });
    expect(calls).toHaveLength(1);
    expect((await sql('select result from approvals where id = $1', [b])).rows[0].result.transport).toBe('browser');
  });

  it('does not touch the browser when the session is not valid: it waits for a login and raises the item', async () => {
    const calls: unknown[] = [];
    await asBrowser();
    await sql("update channel_accounts set session_state = 'expired' where id = $1", [xId]);
    const id = await approvedPost();
    expect(await executors(fakeDriver(calls)).run(id)).toMatchObject({ status: 'needs_login' });
    expect(calls).toHaveLength(0);
    expect((await sql('select status from approvals where id = $1', [id])).rows[0].status).toBe('approved');
    expect((await sql("select count(*)::int as n from action_items where kind = 'session_expired'")).rows[0].n).toBe(1);
  });

  it('marks the session expired when the driver finds the login gone', async () => {
    await asBrowser();
    const id = await approvedPost();
    const gone: BrowserDriver = { publish: async () => { throw new SessionExpiredError('redirected to the login page'); } };
    expect(await executors(gone).run(id)).toMatchObject({ status: 'needs_login' });
    expect((await acct()).session_state).toBe('expired');
  });

  it('refuses, and says why, when an account is set to the browser but the server has no browser transport', async () => {
    await asBrowser();
    const id = await approvedPost();
    expect(await executors().run(id)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/browser/i) });
  });
});

describe('logging in by hand (S5-3)', () => {
  const launcher = (over: Partial<LoginLauncher> = {}): LoginLauncher & { opened: { dir: string; url: string }[] } => {
    const opened: { dir: string; url: string }[] = [];
    return { opened, open: async (dir, url) => { opened.push({ dir, url }); mkdirSync(dir, { recursive: true }); }, waitUntilClosed: async () => undefined, ...over };
  };

  it('refuses an account it does not know, and one that is not a posting account', async () => {
    const l = launcher();
    await expect(loginAccount(sys.app, ws(), sys.dataDir, 'nobody', l)).rejects.toThrow(/no account/i);
    await sql("insert into channel_accounts (workspace_id, channel, handle) values ($1, 'email', 'mail@acme.test')", [ws()]);
    await expect(loginAccount(sys.app, ws(), sys.dataDir, 'mail@acme.test', l)).rejects.toThrow(/not a posting account/i);
    expect(l.opened).toHaveLength(0);
  });

  it('opens a visible browser on the account\'s profile at the platform\'s login page, then records the profile and a valid session', async () => {
    const l = launcher();
    const out = await loginAccount(sys.app, ws(), sys.dataDir, '@acme_test', l);
    expect(l.opened).toHaveLength(1);
    expect(l.opened[0]!.dir).toBe(profileDir(sys.dataDir, xId));
    expect(l.opened[0]!.url).toMatch(/^https:\/\/(x|twitter)\.com\//);
    expect(out).toMatchObject({ handle: '@acme_test' });
    expect(await acct()).toMatchObject({ browser_profile: xId, session_state: 'valid', transport: 'outbox' }); // logging in does not switch it on
    expect(existsSync(profileDir(sys.dataDir, xId))).toBe(true);
  });

  it('leaves the account as it was when the browser could not be opened, and closes any open expired-login item when it works', async () => {
    await expect(loginAccount(sys.app, ws(), sys.dataDir, '@acme_test', launcher({ open: async () => { throw new Error('no browser found'); } }))).rejects.toThrow(/no browser found/);
    expect(await acct()).toMatchObject({ browser_profile: null, session_state: 'none' });
    await call('POST', `/browser/accounts/${xId}/session`, { state: 'expired' });
    await loginAccount(sys.app, ws(), sys.dataDir, xId, launcher());
    expect((await sql("select count(*)::int as n from action_items where kind = 'session_expired' and status = 'open'")).rows[0].n).toBe(0);
  });

  it('never reads or stores a password: nothing but the profile folder is written', async () => {
    await loginAccount(sys.app, ws(), sys.dataDir, xId, launcher());
    const row = JSON.stringify((await sql('select * from channel_accounts where id = $1', [xId])).rows[0]);
    expect(row).not.toMatch(/password|cookie|token/i);
  });
});

describe('the Playwright driver (S5-3)', () => {
  const page = (script: { url?: string; afterPost?: string; loginAfterGoto?: boolean }): DriverPage & { log: string[] } => {
    const log: string[] = [];
    let url = script.url ?? 'about:blank';
    return {
      log,
      async goto(u) { log.push(`goto ${u}`); url = script.loginAfterGoto ? 'https://x.com/i/flow/login' : u; },
      url: () => url,
      async fill(sel, text) { log.push(`fill ${sel} ${text}`); },
      async click(sel) { log.push(`click ${sel}`); if (script.afterPost) url = script.afterPost; },
      async waitForUrlChange() { log.push('wait'); },
      async screenshot() { return Buffer.from('PNG'); },
      async close() { log.push('close'); },
    };
  };

  it('types the approved text into the compose box, presses Post once, and returns the address it ended on with a screenshot', async () => {
    const p = page({ afterPost: 'https://x.com/acme_test/status/42' });
    const out = await playwrightDriver(async () => p).publish({ platform: 'x', handle: '@acme_test', accountId: xId, text: 'Hello from the test' });
    expect(out.finalUrl).toBe('https://x.com/acme_test/status/42');
    expect(out.screenshot.toString()).toBe('PNG');
    expect(p.log.filter((l) => l.startsWith('fill'))).toEqual([expect.stringContaining('Hello from the test')]);
    expect(p.log.filter((l) => l.startsWith('click'))).toHaveLength(1); // once
    expect(p.log.at(-1)).toBe('close');
  });

  it('reports an expired login when the platform sends the browser to its login page, without typing anything', async () => {
    const p = page({ loginAfterGoto: true });
    await expect(playwrightDriver(async () => p).publish({ platform: 'x', handle: '@a', accountId: xId, text: 'x' })).rejects.toBeInstanceOf(SessionExpiredError);
    expect(p.log.some((l) => l.startsWith('fill') || l.startsWith('click'))).toBe(false);
    expect(p.log.at(-1)).toBe('close');
  });

  it('says plainly that Instagram needs an image, which a text post cannot give', async () => {
    await expect(playwrightDriver(async () => page({})).publish({ platform: 'instagram', handle: '@a', accountId: xId, text: 'x' })).rejects.toThrow(/instagram.*image/i);
  });

  it('closes the browser even when the page fails', async () => {
    const p = page({});
    p.click = async () => { throw new Error('button not found'); };
    await expect(playwrightDriver(async () => p).publish({ platform: 'linkedin', handle: 'acme', accountId: xId, text: 'x' })).rejects.toThrow(/button not found/);
    expect(p.log.at(-1)).toBe('close');
    expect(readFileSync(path.join(REPO_ROOT, 'apps/server/src/browser/driver.ts'), 'utf8')).toMatch(/UNVERIFIED/); // the recipes say they have not met a real site
  });
});
