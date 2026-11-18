import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Auth } from '../src/auth';
import { Bus } from '../src/bus';
import { Companies } from '../src/companies';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let companies: Companies;
let app: ReturnType<typeof createApp>;
const handlers: { onOpen?: (e: unknown, s: Sock) => void; onMessage?: (e: { data: unknown }, s: Sock) => void; onClose?: () => void }[] = [];
interface Sock {
  sent: Record<string, unknown>[];
  send(m: string): void;
  close(): void;
}
const sock = (): Sock => ({ sent: [], send(m) { this.sent.push(JSON.parse(m)); }, close() {} });
const ws = () => sys.workspace.id;
const sql = (id: string, q: string, p: unknown[] = []) => withWorkspace(sys.app, id, ({ client }) => client.query(q, p));
const call = (method: string, url: string, body?: unknown, company?: string, cookie?: string) =>
  app.request(url, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(company ? { 'x-company': company } : {}), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** A stand-in for sign-in: the cookie "s=<user>.<session>" is a session. */
const auth = {
  config: { webOrigin: 'http://localhost:3000' },
  handler: async () => new Response('x'),
  session: async (h: Headers) => {
    const m = /s=([^.;]+)\.([^;]+)/.exec(h.get('cookie') ?? '');
    return m ? { userId: m[1]!, sessionId: m[2]! } : null;
  },
} as unknown as Auth;

beforeAll(async () => {
  ({ sys } = await testSystem());
  // Team mode (S9-3): a person who is not on the list is a viewer, so the stand-in sign-in user is the owner.
  await sql(ws(), "insert into members (workspace_id, user_id, role) values ($1, 'u1', 'owner') on conflict do nothing", [ws()]);
  companies = new Companies({ dataDir: sys.dataDir, templatesRoot: sys.templatesRoot, pool: sys.app, defaultCompany: { id: ws(), slug: sys.workspace.slug, root: sys.companyRoot } });
  const upgrade = ((factory: (c: unknown) => (typeof handlers)[number]) => async (c: { text: (s: string) => Response }) => {
    handlers.push(factory(c));
    return c.text('upgraded');
  }) as never;
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot, companies, upgradeWebSocket: upgrade, auth });
}, 240_000);
afterAll(async () => sys?.close());

const IN = 's=u1.a';
let acme = '';
let beta = '';

describe('the companies API (S6-13a)', () => {
  it('lists the companies and the templates, and only to someone signed in', async () => {
    expect((await call('GET', '/api/companies')).status).toBe(401);
    const r = await call('GET', '/api/companies', undefined, undefined, IN);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { companies: { id: string; slug: string; isDefault: boolean }[]; templates: string[] };
    expect(body.companies).toMatchObject([{ id: ws(), slug: 'local', isDefault: true }]);
    expect(body.templates).toContain('starter');
    expect(JSON.stringify(body)).not.toMatch(/"root"/); // folder paths on this machine are not sent to the browser
  });

  it('makes a company from a template, and lists it', async () => {
    const r = await call('POST', '/api/companies', { name: 'Acme Studio', template: 'starter' }, undefined, IN);
    expect(r.status).toBe(201);
    acme = ((await r.json()) as { id: string }).id;
    await sql(acme, "insert into members (workspace_id, user_id, role) values ($1, 'u1', 'owner') on conflict do nothing", [acme]);
    const list = (await (await call('GET', '/api/companies', undefined, undefined, IN)).json()) as { companies: { slug: string }[] };
    expect(list.companies.map((c) => c.slug)).toEqual(['local', 'acme-studio']);
    beta = ((await (await call('POST', '/api/companies', { name: 'Beta', template: 'starter' }, undefined, IN)).json()) as { id: string }).id;
  });

  it('refuses a bad name or template with a plain message', async () => {
    const a = await call('POST', '/api/companies', { name: '   ', template: 'starter' }, undefined, IN);
    expect(a.status).toBe(400);
    expect(((await a.json()) as { error: string }).error).toMatch(/name/i);
    const b = await call('POST', '/api/companies', { name: 'X Co', template: '../agents' }, undefined, IN);
    expect(b.status).toBe(400);
    expect((await call('POST', '/api/companies', { name: 5 }, undefined, IN)).status).toBe(400);
    expect((await call('POST', '/api/companies', undefined, undefined, IN)).status).toBe(415);
  });
});

describe('every request is for one company (S6-13a)', () => {
  it('answers from the company the request names, and from the default one when it names none', async () => {
    const own = (await (await call('GET', '/api/goals', undefined, acme, IN)).json()) as { departments: { key: string }[] };
    expect(own.departments.map((d) => d.key).sort()).toEqual(['lead-gen:qualified_leads_per_week', 'outreach:positive_replies_per_week']); // the starter's two department goals
    expect((await call('GET', '/api/goals', undefined, ws(), IN)).status).toBe(200);
    expect((await call('GET', '/api/goals', undefined, undefined, IN)).status).toBe(200);
  });

  it('keeps a task in the company it was made in: others never see it', async () => {
    const made = await call('POST', '/api/tasks', { title: 'Only for Acme' }, acme, IN);
    expect(made.status).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    const titles = async (c?: string) => ((await (await call('GET', '/api/tasks', undefined, c, IN)).json()) as { title: string }[]).map((t) => t.title);
    expect(await titles(acme)).toContain('Only for Acme');
    expect(await titles()).not.toContain('Only for Acme');
    expect(await titles(beta)).not.toContain('Only for Acme');
    expect((await sql(acme, 'select workspace_id from tasks where id = $1', [id])).rows[0].workspace_id).toBe(acme);
    expect((await sql(ws(), 'select id from tasks where id = $1', [id])).rows).toHaveLength(0);
  });

  it('serves each company its own office', async () => {
    const office = (await (await call('GET', '/api/office', undefined, acme, IN)).json()) as { map: { rooms: { name: string }[] }; agents: unknown[] };
    expect(office.map.rooms.length).toBeGreaterThan(3);
    expect(office.agents).toEqual([]);
  });

  it('refuses a company that is not on the list, and a malformed id', async () => {
    for (const bad of ['11111111-1111-4111-8111-111111111111', 'not-an-id', "'; drop table tasks;--"]) {
      expect((await call('GET', '/api/tasks', undefined, bad, IN)).status, bad).toBe(404);
    }
  });

  it('still needs a sign-in when a company is named', async () => {
    expect((await call('GET', '/api/tasks', undefined, acme)).status).toBe(401);
  });

  it('lets a browser ask for a company: the preflight allows the header', async () => {
    const r = await app.request('/api/tasks', { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:3000', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-company' } });
    expect(r.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-company');
  });

  it('keeps presence separate: people in one company are not seen by another', async () => {
    const open = async (company: string | null, session: string) => {
      const before = handlers.length;
      const res = await app.request(company ? `/events?company=${company}` : '/events', { headers: { cookie: `s=u1.${session}` } });
      expect(await res.text()).toBe('upgraded');
      const h = handlers[before]!;
      const s = sock();
      h.onOpen?.({}, s);
      return { s, say: (m: unknown) => h.onMessage?.({ data: JSON.stringify(m) }, s) };
    };
    const move = { type: 'presence', x: 3, y: 3, availability: 'available', handRaised: false };
    const inAcme1 = await open(acme, 'p1');
    const inAcme2 = await open(acme, 'p2');
    const inBeta = await open(beta, 'p3');
    const inDefault = await open(null, 'p4');
    inAcme1.say(move);
    expect(inAcme2.s.sent.filter((m) => m.kind === 'presence')).toHaveLength(1);
    expect(inBeta.s.sent.filter((m) => String(m.kind).startsWith('presence'))).toHaveLength(0);
    expect(inDefault.s.sent.filter((m) => String(m.kind).startsWith('presence'))).toHaveLength(0);
  });
});
