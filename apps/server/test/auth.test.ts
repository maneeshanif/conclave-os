import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createAuth, type Auth } from '../src/auth';
import { resolveAuthConfig, type AuthConfig } from '../src/config';
import { withWorkspace } from '../src/db/tenant';
import { Bus } from '../src/bus';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

describe('where the server may listen and when login is required (S1-10, CLAUDE.md rule 9)', () => {
  it('is loopback with no login by default', () => {
    expect(resolveAuthConfig({})).toMatchObject({ login: false, host: '127.0.0.1', secureCookies: false });
  });

  it('lets login be switched on locally, and then cookies are still not Secure on plain http loopback', () => {
    expect(resolveAuthConfig({ LOGIN: 'on' })).toMatchObject({ login: true, host: '127.0.0.1', secureCookies: false });
  });

  it('refuses to listen on any other interface without login', () => {
    for (const env of [{ BIND_HOST: '0.0.0.0' }, { BIND_HOST: '192.168.1.5', LOGIN: 'off' }, { BIND_HOST: '::', LOGIN: '' }]) {
      expect(() => resolveAuthConfig({ ...env, PUBLIC_WEB_ORIGIN: 'https://os.example.ts.net' })).toThrow(/login is required/i);
    }
  });

  it('refuses a non-loopback interface without an https address for the web app, so cookies can be Secure', () => {
    expect(() => resolveAuthConfig({ BIND_HOST: '0.0.0.0', LOGIN: 'on' })).toThrow(/PUBLIC_WEB_ORIGIN/);
    expect(() => resolveAuthConfig({ BIND_HOST: '0.0.0.0', LOGIN: 'on', PUBLIC_WEB_ORIGIN: 'http://os.example' })).toThrow(/https/);
  });

  it('marks cookies Secure once the server listens beyond loopback', () => {
    const c = resolveAuthConfig({ BIND_HOST: '100.64.0.7', LOGIN: 'on', PUBLIC_WEB_ORIGIN: 'https://os.tail1234.ts.net' });
    expect(c).toMatchObject({ login: true, secureCookies: true, host: '100.64.0.7', rpID: 'os.tail1234.ts.net' });
  });

  it('uses localhost as the passkey identity locally, because an IP address cannot be one', () => {
    expect(resolveAuthConfig({ LOGIN: 'on' })).toMatchObject({ rpID: 'localhost', webOrigin: 'http://localhost:3000' });
  });

  it('treats loopback spellings as loopback', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) expect(resolveAuthConfig({ BIND_HOST: host }).login).toBe(false);
  });
});

let sys: System;
let dataDir: string;
let config: AuthConfig;
let auth: Auth;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json', origin: 'http://localhost:3000' };

function buildApp(a: Auth, upgradeWebSocket?: Parameters<typeof createApp>[0] extends infer D ? (D extends { upgradeWebSocket?: infer U } ? U : never) : never) {
  return createApp({
    pool: sys.app,
    workspaceId: ws(),
    tokens: new RunTokens(),
    store: new MemoryOsStore(),
    bus: new Bus(),
    dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })),
    auth: a,
    ...(upgradeWebSocket ? { upgradeWebSocket } : {}),
  });
}
let app: ReturnType<typeof buildApp>;

const enrol = (code: string, origin = 'http://localhost:3000') =>
  app.request('/api/auth/owner/enrol', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ code }) });
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

beforeAll(async () => {
  ({ sys } = await testSystem());
  dataDir = mkdtempSync(path.join(tmpdir(), 'conclave-auth-'));
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  config = resolveAuthConfig({ LOGIN: 'on' });
  await sys.app.query('delete from auth.passkey; delete from auth.session; delete from auth.account; delete from auth."user"; delete from auth.enrol_code; delete from auth.verification');
  await sql("delete from members where role = 'owner'");
  auth = createAuth({ pool: sys.app, workspaceId: ws(), config, dataDir, secret: 'test-secret-test-secret-test-secret-123456' });
  app = buildApp(auth);
});

describe('the login wall (S1-10)', () => {
  it('answers 401 to an API call with no session, and still answers the health check', async () => {
    expect((await app.request('/api/agents')).status).toBe(401);
    expect((await app.request('/api/approvals')).status).toBe(401);
    expect((await app.request('/api/settings', { method: 'PATCH', headers: json, body: '{"killSwitch":true}' })).status).toBe(401);
    expect((await app.request('/health')).status).toBe(200);
  });

  it('answers 200 with a session', async () => {
    const res = await enrol(await auth.issueEnrolCode());
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect((await app.request('/api/agents', { headers: { cookie } })).status).toBe(200);
    expect((await app.request('/api/agents', { headers: { cookie: 'better-auth.session_token=forged' } })).status).toBe(401);
  });

  it('is not there when login is off', async () => {
    const open = createApp({ pool: sys.app, workspaceId: ws(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
    expect((await open.request('/api/agents')).status).toBe(200);
  });

  it('guards the live event socket too', async () => {
    const fake = (() => async (c: { text: (s: string) => Response }) => c.text('upgraded')) as never;
    const guarded = buildApp(auth, fake);
    expect((await guarded.request('/events')).status).toBe(401);
    const cookie = cookieOf(await enrol(await auth.issueEnrolCode()));
    expect(await (await guarded.request('/events', { headers: { cookie } })).text()).toBe('upgraded');
  });

  it('leaves the agents\' own run-token endpoint to its token', async () => {
    const res = await app.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect([401, 400, 404, 406]).toContain(res.status); // refused for want of a run token, not by the wall
  });

  it('ends a session on sign-out', async () => {
    const cookie = cookieOf(await enrol(await auth.issueEnrolCode()));
    expect((await app.request('/api/auth/sign-out', { method: 'POST', headers: { ...json, cookie }, body: '{}' })).status).toBe(200);
    expect((await app.request('/api/agents', { headers: { cookie } })).status).toBe(401);
  });
});

describe('the cookie (S1-10)', () => {
  it('is HttpOnly and SameSite, and not Secure on loopback', async () => {
    const res = await enrol(await auth.issueEnrolCode());
    const set = res.headers.getSetCookie().find((c) => /session_token/.test(c))!;
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).not.toMatch(/;\s*Secure/i);
    expect(set).toMatch(/Path=\//i);
  });

  it('is Secure when the server listens beyond loopback', async () => {
    const remote = resolveAuthConfig({ BIND_HOST: '100.64.0.7', LOGIN: 'on', PUBLIC_WEB_ORIGIN: 'https://os.tail1234.ts.net' });
    const a = createAuth({ pool: sys.app, workspaceId: ws(), config: remote, dataDir, secret: 'test-secret-test-secret-test-secret-123456' });
    const r = buildApp(a);
    const res = await r.request('https://os.tail1234.ts.net/api/auth/owner/enrol', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://os.tail1234.ts.net' },
      body: JSON.stringify({ code: await a.issueEnrolCode() }),
    });
    expect(res.status).toBe(200);
    const set = res.headers.getSetCookie().find((c) => /session_token/.test(c))!;
    expect(set).toMatch(/;\s*Secure/i);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
  });
});

describe('enrolling the owner (S1-10)', () => {
  it('turns a one-time code into the owner and a session, once', async () => {
    const code = await auth.issueEnrolCode();
    expect((await enrol(code)).status).toBe(200);
    expect((await sql("select user_id from members where role = 'owner'")).rows).toHaveLength(1);
    expect((await enrol(code)).status).toBe(401); // used
  });

  it('refuses a wrong code and says nothing about why', async () => {
    await auth.issueEnrolCode();
    const res = await enrol('WRONGCODE1');
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toMatch(/expired|used|exists/i);
  });

  it('refuses an expired code', async () => {
    const code = await auth.issueEnrolCode();
    await sys.app.query("update auth.enrol_code set expires_at = now() - interval '1 minute'");
    expect((await enrol(code)).status).toBe(401);
  });

  it('keeps only a hash of the code', async () => {
    const code = await auth.issueEnrolCode();
    const rows = (await sys.app.query('select * from auth.enrol_code')).rows;
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it('locks enrolment after repeated wrong guesses, even for the right code', async () => {
    const code = await auth.issueEnrolCode();
    for (let i = 0; i < 10; i++) await enrol(`GUESS${i}XXXX`);
    expect((await enrol(code)).status).toBe(429);
  });

  it('does not enrol from a foreign origin', async () => {
    const res = await enrol(await auth.issueEnrolCode(), 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('will not issue a first-owner code once an owner exists', async () => {
    await enrol(await auth.issueEnrolCode());
    await expect(auth.issueEnrolCode()).rejects.toThrow(/owner already exists/i);
  });

  it('lets a signed-in owner issue a code for another device, which signs in as the same owner', async () => {
    const first = await enrol(await auth.issueEnrolCode());
    const cookie = cookieOf(first);
    const issued = await app.request('/api/owner/codes', { method: 'POST', headers: { ...json, cookie }, body: '{}' });
    expect(issued.status).toBe(200);
    const { code } = (await issued.json()) as { code: string };
    const second = await enrol(code);
    expect(second.status).toBe(200);
    expect((await sql("select user_id from members where role = 'owner'")).rows).toHaveLength(1);
    expect((await sys.app.query('select count(distinct user_id)::int as n from auth.session')).rows[0].n).toBe(1);
    expect((await app.request('/api/owner/codes', { method: 'POST', headers: json, body: '{}' })).status).toBe(401);
  });

  it('writes the first setup code to a file for the person at the machine, and removes it when used', async () => {
    const file = path.join(dataDir, 'owner-setup-code.txt');
    const result = await auth.ensureSetupCode();
    expect(result.file).toBe(file);
    expect(existsSync(file)).toBe(true);
    const code = readFileSync(file, 'utf8').trim();
    expect((await enrol(code)).status).toBe(200);
    expect(existsSync(file)).toBe(false);
    expect((await auth.ensureSetupCode()).file).toBeNull(); // there is an owner, nothing to set up
  });
});

describe('devices (S1-10)', () => {
  it('lists signed-in devices and revokes one', async () => {
    const cookie = cookieOf(await enrol(await auth.issueEnrolCode()));
    const other = cookieOf(await enrol(((await (await app.request('/api/owner/codes', { method: 'POST', headers: { ...json, cookie }, body: '{}' })).json()) as { code: string }).code));
    const list = (await (await app.request('/api/owner/devices', { headers: { cookie } })).json()) as { id: string; current: boolean }[];
    expect(list).toHaveLength(2);
    expect(list.filter((d) => d.current)).toHaveLength(1);
    const target = list.find((d) => !d.current)!;
    expect((await app.request(`/api/owner/devices/${target.id}`, { method: 'DELETE', headers: { ...json, cookie }, body: '{}' })).status).toBe(200);
    expect((await app.request('/api/agents', { headers: { cookie: other } })).status).toBe(401);
    expect((await app.request('/api/agents', { headers: { cookie } })).status).toBe(200);
  });
});

describe('passkeys (S1-10)', () => {
  it('is open to sign-in without a session, and issues a challenge for this machine\'s identity', async () => {
    const res = await app.request('/api/auth/passkey/generate-authenticate-options', { headers: { origin: 'http://localhost:3000' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string; rpId?: string };
    expect(body.challenge.length).toBeGreaterThan(10);
    expect(body.rpId).toBe('localhost');
  });

  it('will not start adding a passkey without a session, and will with one', async () => {
    expect((await app.request('/api/auth/passkey/generate-register-options', { headers: { origin: 'http://localhost:3000' } })).status).toBeGreaterThanOrEqual(400);
    const cookie = cookieOf(await enrol(await auth.issueEnrolCode()));
    const res = await app.request('/api/auth/passkey/generate-register-options', { headers: { origin: 'http://localhost:3000', cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rp: { id: string } }).rp.id).toBe('localhost');
  });
});

describe('which device decided (S1-11)', () => {
  it('records the device an approval was decided from, on the approval and in the audit log', async () => {
    const cookie = cookieOf(await enrol(await auth.issueEnrolCode()));
    const ap = (await sql("insert into approvals (workspace_id, kind, status, payload, dedupe_key) values ($1, 'post.publish', 'pending', '{}', $2) returning id", [ws(), `dev:${Date.now()}`])).rows[0].id as string;
    const res = await app.request(`/api/approvals/${ap}/decide`, { method: 'POST', headers: { ...json, cookie, 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126' }, body: '{"approved":false}' });
    expect(res.status).toBe(200);
    const row = (await sql('select decided_device from approvals where id = $1', [ap])).rows[0];
    expect(row.decided_device).toContain('Pixel 8');
    const audit = (await sql("select data from audit_log where subject = $1 and action = 'approval.decided'", [ap])).rows[0].data;
    expect(audit.device).toContain('Pixel 8');
  });

  it('records no device when login is off', async () => {
    const open = createApp({ pool: sys.app, workspaceId: ws(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
    const ap = (await sql("insert into approvals (workspace_id, kind, status, payload, dedupe_key) values ($1, 'post.publish', 'pending', '{}', $2) returning id", [ws(), `dev2:${Date.now()}`])).rows[0].id as string;
    expect((await open.request(`/api/approvals/${ap}/decide`, { method: 'POST', headers: json, body: '{"approved":false}' })).status).toBe(200);
    expect((await sql('select decided_device from approvals where id = $1', [ap])).rows[0].decided_device).toBeNull();
  });
});
