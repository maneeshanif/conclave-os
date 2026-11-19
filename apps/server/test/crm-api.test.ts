import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const call = (method: string, path: string, body?: unknown) => app.request(`/api${path}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
const ok = async <T>(res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from deals');
  await sql('delete from contacts');
  await sql('update leads set account_id = null');
  await sql('delete from accounts');
  await sql('delete from leads');
});

describe('accounts (S2-1)', () => {
  it('creates, lists, reads and edits an account', async () => {
    const { id } = await ok<{ id: string }>(await call('POST', '/accounts', { name: 'Glow Clinic', website: 'https://glow.test', market: 'services', notes: 'Owner-led.' }), 201);
    const list = await ok<{ id: string; name: string; stage: string }[]>(await call('GET', '/accounts'));
    expect(list).toEqual([expect.objectContaining({ id, name: 'Glow Clinic', stage: 'prospect' })]);
    await ok(await call('PATCH', `/accounts/${id}`, { stage: 'client', health: 'good' }));
    const one = await ok<{ stage: string; health: string; contacts: unknown[]; deals: unknown[] }>(await call('GET', `/accounts/${id}`));
    expect(one).toMatchObject({ stage: 'client', health: 'good', contacts: [], deals: [] });
  });

  it('refuses nonsense: no name, a bad stage, a bad address, an unknown id', async () => {
    expect((await call('POST', '/accounts', {})).status).toBe(400);
    expect((await call('POST', '/accounts', { name: 'X', website: 'javascript:alert(1)' })).status).toBe(400);
    const { id } = await ok<{ id: string }>(await call('POST', '/accounts', { name: 'X' }), 201);
    expect((await call('PATCH', `/accounts/${id}`, { stage: 'nonsense' })).status).toBe(400);
    expect((await call('PATCH', `/accounts/${id}`, {})).status).toBe(400);
    expect((await call('GET', '/accounts/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await call('GET', '/accounts/nope')).status).toBe(404);
  });
});

describe('contacts and deals (S2-1)', () => {
  it('adds a contact and a deal to an account and shows them on it', async () => {
    const { id: accountId } = await ok<{ id: string }>(await call('POST', '/accounts', { name: 'Glow Clinic' }), 201);
    const c = await ok<{ id: string }>(await call('POST', '/contacts', { accountId, name: 'Dana', role: 'Owner', email: 'Dana@Glow.test', instagram: '@glow' }), 201);
    const d = await ok<{ id: string }>(await call('POST', '/deals', { accountId, offer: 'Homepage concept', value: 2500, nextStep: 'Send concept', due: '2026-12-01' }), 201);
    const acct = await ok<{ contacts: { id: string; email: string }[]; deals: { id: string; value: string; stage: string }[] }>(await call('GET', `/accounts/${accountId}`));
    expect(acct.contacts).toEqual([expect.objectContaining({ id: c.id, email: 'dana@glow.test' })]); // stored lowercase
    expect(acct.deals).toEqual([expect.objectContaining({ id: d.id, stage: 'open' })]);
    expect(Number(acct.deals[0]!.value)).toBe(2500);
    await ok(await call('PATCH', `/deals/${d.id}`, { nextStep: 'Call Dana', value: 3000 }));
    expect(Number((await ok<{ value: string }>(await call('GET', `/deals/${d.id}`))).value)).toBe(3000);
  });

  it('refuses a contact or deal for an account that does not exist, and a negative value', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await call('POST', '/contacts', { accountId: ghost, name: 'X' })).status).toBe(404);
    expect((await call('POST', '/deals', { accountId: ghost, offer: 'X' })).status).toBe(404);
    const { id: accountId } = await ok<{ id: string }>(await call('POST', '/accounts', { name: 'A' }), 201);
    expect((await call('POST', '/deals', { accountId, offer: 'X', value: -5 })).status).toBe(400);
  });

  it('cannot point a contact at another workspace\'s account (the database refuses)', async () => {
    const other = (await sys.app.query("select 1")).rowCount; // keep the pool warm
    void other;
    const { id: accountId } = await ok<{ id: string }>(await call('POST', '/accounts', { name: 'A' }), 201);
    // A forged workspace id on the row cannot be written at all: row-level security refuses it.
    await expect(
      withWorkspace(sys.app, ws(), ({ client }) =>
        client.query("insert into contacts (workspace_id, account_id, name) values ('00000000-0000-4000-8000-0000000000aa', $1, 'Eve')", [accountId]),
      ),
    ).rejects.toThrow();
  });

  it('lists contacts and deals filtered by account', async () => {
    const a = (await ok<{ id: string }>(await call('POST', '/accounts', { name: 'A' }), 201)).id;
    const b = (await ok<{ id: string }>(await call('POST', '/accounts', { name: 'B' }), 201)).id;
    await call('POST', '/contacts', { accountId: a, name: 'A1' });
    await call('POST', '/contacts', { accountId: b, name: 'B1' });
    expect((await ok<{ name: string }[]>(await call('GET', `/contacts?accountId=${a}`))).map((c) => c.name)).toEqual(['A1']);
  });
});

describe('promoting a lead (S2-1)', () => {
  const lead = async () => (await ok<{ id: string }>(await call('POST', '/leads', { businessName: 'Glow Clinic', contactName: 'Dana', email: 'dana@glow.test', website: 'https://glow.test', notes: 'Booking page asks for a phone call.' }), 201)).id;

  it('makes the account, the contact and a deal from a lead, in one step', async () => {
    const id = await lead();
    const r = await ok<{ accountId: string; contactId: string; dealId: string; existed: boolean }>(await call('POST', `/leads/${id}/promote`, {}), 201);
    expect(r.existed).toBe(false);
    const acct = await ok<{ name: string; website: string; notes: string; contacts: { name: string; email: string }[]; deals: { id: string }[] }>(await call('GET', `/accounts/${r.accountId}`));
    expect(acct).toMatchObject({ name: 'Glow Clinic', website: 'https://glow.test', notes: 'Booking page asks for a phone call.' });
    expect(acct.contacts).toEqual([expect.objectContaining({ name: 'Dana', email: 'dana@glow.test' })]);
    expect(acct.deals.map((d) => d.id)).toEqual([r.dealId]);
    expect((await sql('select account_id from leads where id = $1', [id])).rows[0].account_id).toBe(r.accountId);
  });

  it('promoting twice makes nothing new and says so', async () => {
    const id = await lead();
    const first = await ok<{ accountId: string; contactId: string; dealId: string }>(await call('POST', `/leads/${id}/promote`, {}), 201);
    const second = await ok<{ accountId: string; contactId: string; dealId: string; existed: boolean }>(await call('POST', `/leads/${id}/promote`, {}), 200);
    expect(second).toMatchObject({ ...first, existed: true });
    for (const t of ['accounts', 'contacts', 'deals']) expect((await sql(`select count(*)::int as n from ${t}`)).rows[0].n).toBe(1);
  });

  it('two promotions at once still make one of each', async () => {
    const id = await lead();
    const rs = await Promise.all([call('POST', `/leads/${id}/promote`, {}), call('POST', `/leads/${id}/promote`, {})]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 201]);
    for (const t of ['accounts', 'contacts', 'deals']) expect((await sql(`select count(*)::int as n from ${t}`)).rows[0].n).toBe(1);
  });

  it('refuses a lead on the do-not-contact list, and an unknown lead', async () => {
    const id = await lead();
    await sql("update leads set stage = 'do_not_contact' where id = $1", [id]);
    expect((await call('POST', `/leads/${id}/promote`, {})).status).toBe(409);
    expect((await call('POST', '/leads/00000000-0000-4000-8000-000000000000/promote', {})).status).toBe(404);
  });

  it('records the promotion in the audit log', async () => {
    const id = await lead();
    await call('POST', `/leads/${id}/promote`, {});
    expect((await sql("select 1 from audit_log where action = 'lead.promoted' and subject = $1", [id])).rowCount).toBe(1);
  });
});
