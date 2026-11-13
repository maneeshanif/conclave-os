import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { addSignal, normalizeUrl } from '../src/signals';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const send = (method: string, p: string, body?: unknown) => app.request(p, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (p: string, body: unknown = {}) => send('POST', p, body);
const uniq = () => randomUUID().slice(0, 8);
type Sig = { id: string; kind: string; source: string; url: string; status: string; score: number | null; leadId: string | null; duplicate?: boolean; error?: string };
const make = async (over: Record<string, unknown> = {}) => {
  const res = await post('/api/signals', { kind: 'service_request', source: 'reddit', url: `https://reddit.example/r/smallbiz/comments/${uniq()}`, author: 'u/dana_clinic', excerpt: 'Looking for someone to rebuild our booking page.', ...over });
  return { res, body: (await res.json()) as Sig };
};

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from signals');
});

describe('web addresses are compared in one form (S4-6)', () => {
  it('ignores the fragment, tracking parameters, a trailing slash, the case of the host and a leading www', () => {
    const a = normalizeUrl('https://WWW.Reddit.example/r/x/comments/1/?utm_source=feed&ref=abc#top');
    expect(a).toBe('https://reddit.example/r/x/comments/1?ref=abc');
    expect(normalizeUrl('https://reddit.example/r/x/comments/1?ref=abc')).toBe(a);
    expect(normalizeUrl('http://reddit.example/')).toBe('http://reddit.example/');
  });
  it('refuses what is not an http or https address', () => {
    for (const bad of ['', 'not a url', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.test/a']) expect(() => normalizeUrl(bad), bad).toThrow(/web address/i);
  });
});

describe('the signals API (S4-6)', () => {
  it('adds a signal in status new and reads it back', async () => {
    const { res, body } = await make();
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ kind: 'service_request', source: 'reddit', status: 'new', score: null, leadId: null });
    const got = await app.request(`/api/signals/${body.id}`);
    expect(((await got.json()) as Sig).id).toBe(body.id);
  });

  it('keeps one signal per address, however it is written, and says it was a duplicate', async () => {
    const url = `https://reddit.example/r/x/comments/${uniq()}`;
    const first = await make({ url });
    const again = await make({ url: `${url}/?utm_medium=x#reply` });
    expect(again.res.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, duplicate: true });
    expect((await sql('select count(*)::int as n from signals')).rows[0].n).toBe(1);
  });

  it('refuses a bad kind, a missing address, a non-web address and an over-long excerpt', async () => {
    expect((await make({ kind: 'rumour' })).res.status).toBe(400);
    expect((await make({ url: undefined })).res.status).toBe(400);
    expect((await make({ url: 'javascript:alert(1)' })).res.status).toBe(400);
    expect((await make({ excerpt: 'x'.repeat(5001) })).res.status).toBe(400);
  });

  it('lists by status and kind, newest first, with a limit', async () => {
    const a = await make({ kind: 'pain_point' });
    await make();
    await make();
    await post(`/api/signals/${a.body.id}/qualify`, { score: 80 });
    const all = (await (await app.request('/api/signals')).json()) as Sig[];
    expect(all).toHaveLength(3);
    expect(((await (await app.request('/api/signals?status=qualified')).json()) as Sig[]).map((s) => s.id)).toEqual([a.body.id]);
    expect(((await (await app.request('/api/signals?kind=service_request')).json()) as Sig[]).every((s) => s.kind === 'service_request')).toBe(true);
    expect(((await (await app.request('/api/signals?limit=1')).json()) as Sig[])).toHaveLength(1);
    expect((await app.request('/api/signals?status=nonsense')).status).toBe(400);
  });

  it('qualifies with a score and a reason, and dismisses', async () => {
    const { body } = await make();
    const q = await post(`/api/signals/${body.id}/qualify`, { score: 72, reason: 'Asks for exactly what we sell.' });
    expect(q.status).toBe(200);
    expect(await q.json()).toMatchObject({ status: 'qualified', score: 72 });
    expect((await post(`/api/signals/${body.id}/qualify`, { score: 101 })).status).toBe(400);
    const d = await post(`/api/signals/${body.id}/dismiss`, { reason: 'A job ad, not a person.' });
    expect(await d.json()).toMatchObject({ status: 'dismissed' });
    // A dismissed signal can be reopened by qualifying it again.
    expect(((await (await post(`/api/signals/${body.id}/qualify`, { score: 60 })).json()) as Sig).status).toBe('qualified');
  });

  it('promotes to one lead that carries the signal as its source, and promoting twice changes nothing', async () => {
    const { body } = await make({ author: 'u/dana_clinic', excerpt: 'Need a new site for our clinic.' });
    await post(`/api/signals/${body.id}/qualify`, { score: 90, reason: 'Clear ask.' });
    const p = await post(`/api/signals/${body.id}/promote`);
    expect(p.status).toBe(200);
    const promoted = (await p.json()) as Sig;
    expect(promoted.status).toBe('promoted');
    expect(promoted.leadId).toBeTruthy();
    const lead = (await sql('select source_url, notes, verified, business_name from leads where id = $1', [promoted.leadId])).rows[0];
    expect(lead.source_url).toBe(body.url);
    expect(lead.verified).toBe(true);
    expect(lead.notes).toContain('Need a new site for our clinic.');
    expect(lead.business_name).toBe('u/dana_clinic');
    const again = await post(`/api/signals/${body.id}/promote`);
    expect(again.status).toBe(200);
    expect(((await again.json()) as Sig).leadId).toBe(promoted.leadId);
    expect((await sql('select count(*)::int as n from leads where source_url = $1', [body.url])).rows[0].n).toBe(1);
  });

  it('will not promote a dismissed signal, or one that is not there', async () => {
    const { body } = await make();
    await post(`/api/signals/${body.id}/dismiss`);
    expect((await post(`/api/signals/${body.id}/promote`)).status).toBe(409);
    expect((await post(`/api/signals/${randomUUID()}/promote`)).status).toBe(404);
    expect((await app.request('/api/signals/not-an-id')).status).toBe(404);
  });

  it('records who found it, when, and the audit trail of each decision', async () => {
    const { body } = await make();
    await post(`/api/signals/${body.id}/qualify`, { score: 70 });
    const row = (await sql('select found_by, found_at from signals where id = $1', [body.id])).rows[0];
    expect(row.found_by).toBe('founder');
    expect(row.found_at).toBeTruthy();
    const audit = (await sql("select action from audit_log where subject = $1 order by id", [body.id])).rows.map((r) => r.action);
    expect(audit).toEqual(['signal.added', 'signal.qualified']);
  });

  it('is invisible to another workspace', async () => {
    await make();
    const other = (await withWorkspace(sys.app, randomUUID(), ({ client }) => client.query('select count(*)::int as n from signals'))).rows[0].n;
    expect(other).toBe(0);
  });
});

describe('addSignal as the scouts use it (S4-6)', () => {
  it('records the agent that found it and returns whether it was new', async () => {
    const a = await withWorkspace(sys.app, ws(), ({ client }) => addSignal(client, ws(), { kind: 'pain_point', source: 'reddit', url: 'https://reddit.example/r/x/comments/zz1', excerpt: 'Ugh, invoices.' }, 'agent:scout-1'));
    expect(a).toMatchObject({ created: true });
    const b = await withWorkspace(sys.app, ws(), ({ client }) => addSignal(client, ws(), { kind: 'pain_point', source: 'reddit', url: 'https://reddit.example/r/x/comments/zz1#c2', excerpt: 'again' }, 'agent:scout-2'));
    expect(b).toMatchObject({ created: false, id: a.id });
    expect((await sql('select found_by from signals where id = $1', [a.id])).rows[0].found_by).toBe('agent:scout-1');
  });
});
