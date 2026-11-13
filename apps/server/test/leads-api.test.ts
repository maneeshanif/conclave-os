import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import type { Database } from '../src/db';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let db: Database;
let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const get = (p: string) => app.request(p);
const send = (method: string, p: string, body?: unknown) => app.request(p, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (p: string, body: unknown) => send('POST', p, body);
const patch = (p: string, body: unknown) => send('PATCH', p, body);
const del = (p: string, body?: unknown) => send('DELETE', p, body ?? {});
const uniq = () => randomUUID().slice(0, 8);

beforeAll(async () => {
  ({ db, sys } = await testSystem());
  app = createApp({
    pool: sys.app,
    workspaceId: ws(),
    tokens: new RunTokens(),
    store: new MemoryOsStore(),
    bus: new Bus(),
    dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })),
  });
}, 180_000);
afterAll(async () => sys?.close());

async function newLead(body: Record<string, unknown> = {}) {
  const email = `dana-${uniq()}@clinic.test`;
  const res = await post('/api/leads', { businessName: 'Glow Clinic', email, ...body });
  expect(res.status).toBe(201);
  return { id: ((await res.json()) as { id: string }).id, email: String(body.email ?? email).toLowerCase() };
}
const leadOf = async (id: string) => (await (await get(`/api/leads/${id}`)).json()) as Record<string, unknown> & { suppressed: boolean; messages: unknown[] };
const suppressionValues = async () => ((await (await get('/api/suppression')).json()) as { value: string }[]).map((s) => s.value);
const proposing = (leadId: string) =>
  new DbOsStore(sys.app).proposeEmail({ workspaceId: ws(), agentId: randomUUID(), runId: randomUUID() }, { leadId, subject: 'Hello', body: 'Hi there, a short note.', step: 1 });

describe('creating and reading leads (S1-4)', () => {
  it('creates a lead with a normalised address and sensible defaults', async () => {
    const res = await post('/api/leads', { businessName: 'Glow Clinic', email: '  Dana.Owner@Clinic.TEST ', website: 'https://glow.test', contactName: 'Dana', notes: 'Booking asks for a call.' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await leadOf(id)).toMatchObject({
      id,
      business_name: 'Glow Clinic',
      email: 'dana.owner@clinic.test',
      website: 'https://glow.test',
      contact_name: 'Dana',
      stage: 'new',
      market: 'services',
      suppressed: false,
      messages: [],
    });
  });

  it('refuses nonsense', async () => {
    for (const bad of [
      {},
      { email: 'not-an-email' },
      { businessName: 'x', website: 'javascript:alert(1)' },
      { businessName: 'x', website: 'ftp://files.test' },
      { businessName: 'x', stage: 'hot' },
      { businessName: 'x', market: 'mars' },
      { businessName: 'x'.repeat(201) },
      { businessName: 'x', notes: 'n'.repeat(5001) },
    ]) {
      expect((await post('/api/leads', bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('allows a lead with no address yet, as many as you like', async () => {
    expect((await post('/api/leads', { businessName: 'No address A' })).status).toBe(201);
    expect((await post('/api/leads', { businessName: 'No address B' })).status).toBe(201);
  });

  it('refuses a second lead with the same address however it is written, and says which one it is', async () => {
    const first = await newLead();
    const dup = await post('/api/leads', { businessName: 'Again', email: first.email.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ id: first.id });
  });

  it('two creates for one address at the same moment give one lead', async () => {
    const email = `race-${uniq()}@clinic.test`;
    const results = await Promise.all([post('/api/leads', { businessName: 'A', email }), post('/api/leads', { businessName: 'B', email }), post('/api/leads', { businessName: 'C', email })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await sql('select 1 from leads where lower(email) = $1', [email])).rowCount).toBe(1);
  });

  it('creating a lead as do-not-contact puts the address on the suppression list too', async () => {
    const l = await newLead({ stage: 'do_not_contact' });
    expect(await suppressionValues()).toContain(l.email);
  });

  it('answers 404 for an unknown id, a malformed id, and another workspace\'s lead', async () => {
    expect((await get(`/api/leads/${randomUUID()}`)).status).toBe(404);
    expect((await get('/api/leads/not-a-uuid')).status).toBe(404);
    const theirs = await db.withOwner(async (c) => {
      const w = await c.query("insert into workspaces (name, slug) values ('Other', $1) returning id", [`other-${uniq()}`]);
      return (await c.query("insert into leads (workspace_id, business_name, email) values ($1, 'Theirs', 'theirs@other.test') returning id", [w.rows[0].id])).rows[0].id as string;
    });
    expect((await get(`/api/leads/${theirs}`)).status).toBe(404);
    expect((await patch(`/api/leads/${theirs}`, { notes: 'x' })).status).toBe(404);
    expect(((await (await get('/api/leads')).json()) as { id: string }[]).map((l) => l.id)).not.toContain(theirs);
  });
});

describe('listing leads (S1-4)', () => {
  it('lists newest first and filters by stage', async () => {
    const older = await newLead({ businessName: 'Older Co' });
    const newer = await newLead({ businessName: 'Newer Co', stage: 'qualified' });
    const all = ((await (await get('/api/leads')).json()) as { id: string }[]).map((l) => l.id);
    expect(all.indexOf(newer.id)).toBeLessThan(all.indexOf(older.id));
    const qualified = (await (await get('/api/leads?stage=qualified')).json()) as { id: string; stage: string }[];
    expect(qualified.every((l) => l.stage === 'qualified')).toBe(true);
    expect(qualified.map((l) => l.id)).toContain(newer.id);
    expect(qualified.map((l) => l.id)).not.toContain(older.id);
    expect((await get('/api/leads?stage=hot')).status).toBe(400);
  });

  it('searches by name, address, contact and site, and treats % and _ as plain characters', async () => {
    const tag = uniq();
    const a = await newLead({ businessName: `Needle ${tag} Clinic` });
    await newLead({ businessName: 'Haystack' });
    const hit = (await (await get(`/api/leads?q=needle%20${tag}`)).json()) as { id: string }[];
    expect(hit.map((l) => l.id)).toEqual([a.id]);
    const byEmail = (await (await get(`/api/leads?q=${encodeURIComponent(a.email.toUpperCase())}`)).json()) as { id: string }[];
    expect(byEmail.map((l) => l.id)).toContain(a.id);
    const wildcard = (await (await get('/api/leads?q=%25')).json()) as unknown[];
    expect(wildcard).toEqual([]); // "%" is not "match everything"
  });

  it('caps the page size', async () => {
    expect(((await (await get('/api/leads?limit=1')).json()) as unknown[]).length).toBe(1);
    expect((await get('/api/leads?limit=0')).status).toBe(400);
    expect((await get('/api/leads?limit=9999')).status).toBe(400);
  });

  it('flags a lead whose address, or whose whole domain, is suppressed', async () => {
    const one = await newLead();
    const domain = await newLead({ email: `x-${uniq()}@whole-domain-${uniq()}.test` });
    await post('/api/suppression', { value: one.email });
    await post('/api/suppression', { value: domain.email.slice(domain.email.indexOf('@')) });
    const list = (await (await get('/api/leads')).json()) as { id: string; suppressed: boolean }[];
    expect(list.find((l) => l.id === one.id)!.suppressed).toBe(true);
    expect(list.find((l) => l.id === domain.id)!.suppressed).toBe(true);
    const clean = await newLead();
    expect((await leadOf(clean.id)).suppressed).toBe(false);
  });

  it('shows a lead\'s messages', async () => {
    const l = await newLead();
    await sql("insert into outreach_messages (workspace_id, lead_id, step, to_address, subject, body, status) values ($1, $2, 1, $3, 'Hello', 'b', 'queued')", [ws(), l.id, l.email]);
    expect((await leadOf(l.id)).messages).toMatchObject([{ step: 1, subject: 'Hello', status: 'queued' }]);
  });
});

describe('changing a lead (S1-4)', () => {
  it('updates its fields, normalises a new address, and logs it', async () => {
    const l = await newLead();
    const res = await patch(`/api/leads/${l.id}`, { notes: 'Called back.', contactName: 'Dana Owner', stage: 'replied', email: ' New.Address@Clinic.test ' });
    expect(res.status).toBe(200);
    expect(await leadOf(l.id)).toMatchObject({ notes: 'Called back.', contact_name: 'Dana Owner', stage: 'replied', email: 'new.address@clinic.test' });
    const audit = await sql("select actor from audit_log where subject = $1 and action = 'lead.updated'", [l.id]);
    expect(audit.rows).toEqual([{ actor: 'founder' }]);
  });

  it('refuses an empty change, a bad stage, a bad address, and an unknown lead', async () => {
    const l = await newLead();
    expect((await patch(`/api/leads/${l.id}`, {})).status).toBe(400);
    expect((await patch(`/api/leads/${l.id}`, { stage: 'hot' })).status).toBe(400);
    expect((await patch(`/api/leads/${l.id}`, { email: 'nope' })).status).toBe(400);
    expect((await patch(`/api/leads/${randomUUID()}`, { notes: 'x' })).status).toBe(404);
  });

  it('refuses an address that belongs to another lead', async () => {
    const a = await newLead();
    const b = await newLead();
    const res = await patch(`/api/leads/${b.id}`, { email: a.email.toUpperCase() });
    expect(res.status).toBe(409);
    expect((await leadOf(b.id)).email).toBe(b.email);
  });

  it('marking a lead do-not-contact suppresses its address, and then no email can be proposed to it', async () => {
    const l = await newLead();
    expect((await patch(`/api/leads/${l.id}`, { stage: 'do_not_contact' })).status).toBe(200);
    expect(await suppressionValues()).toContain(l.email);
    const row = (await sql('select reason from suppression where value = $1', [l.email])).rows[0];
    expect(row.reason).toMatch(/do not contact/i);
    await expect(proposing(l.id)).rejects.toThrow(/do not contact/);
  });

  it('marking it twice, or when the address is already listed, is fine and adds nothing twice', async () => {
    const l = await newLead();
    await post('/api/suppression', { value: l.email });
    expect((await patch(`/api/leads/${l.id}`, { stage: 'do_not_contact' })).status).toBe(200);
    expect((await patch(`/api/leads/${l.id}`, { stage: 'do_not_contact' })).status).toBe(200);
    expect((await sql('select 1 from suppression where value = $1', [l.email])).rowCount).toBe(1);
  });

  it('a lead without an address can be marked do-not-contact with nothing to suppress', async () => {
    const res = await post('/api/leads', { businessName: 'No address' });
    const { id } = (await res.json()) as { id: string };
    expect((await patch(`/api/leads/${id}`, { stage: 'do_not_contact' })).status).toBe(200);
    expect((await leadOf(id)).stage).toBe('do_not_contact');
  });

  it('does not let a stage change quietly undo do-not-contact while the address is still suppressed', async () => {
    const l = await newLead();
    await patch(`/api/leads/${l.id}`, { stage: 'do_not_contact' });
    const res = await patch(`/api/leads/${l.id}`, { stage: 'new' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/suppression list/i);
    expect((await leadOf(l.id)).stage).toBe('do_not_contact');

    // Only an explicit removal from the list, with a reason, makes it possible.
    const entry = ((await (await get('/api/suppression')).json()) as { id: string; value: string }[]).find((s) => s.value === l.email)!;
    expect((await del(`/api/suppression/${entry.id}`, { reason: 'They asked to hear from us again.' })).status).toBe(200);
    expect((await patch(`/api/leads/${l.id}`, { stage: 'new' })).status).toBe(200);
  });

  it('changing the address on a lead that is do-not-contact suppresses the new address too', async () => {
    const l = await newLead();
    await patch(`/api/leads/${l.id}`, { stage: 'do_not_contact' });
    const newAddr = `moved-${uniq()}@clinic.test`;
    expect((await patch(`/api/leads/${l.id}`, { email: newAddr })).status).toBe(200);
    expect(await suppressionValues()).toContain(newAddr);
  });
});

describe('the suppression list (S1-4)', () => {
  it('stores an address or a whole domain, lowercased and trimmed, and lists the newest first', async () => {
    const tag = uniq();
    const a = await post('/api/suppression', { value: `  Owner-${tag}@Clinic.COM `, reason: 'Unsubscribed.' });
    expect(a.status).toBe(201);
    const d = await post('/api/suppression', { value: `@Block-${tag}.COM` });
    expect(d.status).toBe(201);
    const values = await suppressionValues();
    expect(values).toContain(`owner-${tag}@clinic.com`);
    expect(values).toContain(`@block-${tag}.com`);
    expect(values.indexOf(`@block-${tag}.com`)).toBeLessThan(values.indexOf(`owner-${tag}@clinic.com`));
  });

  it('refuses a value that is neither an address nor a domain', async () => {
    for (const bad of ['', 'clinic.com', 'a b@c.test', '@', 'x@', '@nodot', 'two@@x.test', 'a'.repeat(300) + '@x.test']) {
      expect((await post('/api/suppression', { value: bad })).status, bad).toBe(400);
    }
    expect((await post('/api/suppression', {})).status).toBe(400);
  });

  it('adding the same value again changes nothing and returns the one already there', async () => {
    const value = `again-${uniq()}@clinic.test`;
    const first = (await (await post('/api/suppression', { value })).json()) as { id: string };
    const second = await post('/api/suppression', { value: value.toUpperCase() });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ id: first.id });
    expect((await sql('select 1 from suppression where value = $1', [value])).rowCount).toBe(1);
  });

  it('once an address is listed, no email can be proposed to it, whatever stage the lead is in', async () => {
    const l = await newLead(); // stage "new"
    await post('/api/suppression', { value: l.email.toUpperCase() });
    await expect(proposing(l.id)).rejects.toThrow(/suppression list/);
    const byDomain = await newLead({ email: `x-${uniq()}@blocked-${uniq()}.test` });
    await post('/api/suppression', { value: byDomain.email.slice(byDomain.email.indexOf('@')) });
    await expect(proposing(byDomain.id)).rejects.toThrow(/suppression list/);
  });

  it('logs every addition', async () => {
    const value = `logged-${uniq()}@clinic.test`;
    await post('/api/suppression', { value, reason: 'Replied STOP.' });
    const audit = await sql("select actor, data from audit_log where action = 'suppression.added' and data ->> 'value' = $1", [value]);
    expect(audit.rows).toEqual([{ actor: 'founder', data: { value, reason: 'Replied STOP.' } }]);
  });

  it('removes an entry only on an explicit call that gives a reason, and logs who removed what and why', async () => {
    const value = `removable-${uniq()}@clinic.test`;
    const { id } = (await (await post('/api/suppression', { value, reason: 'Unsubscribed.' })).json()) as { id: string };

    expect((await del(`/api/suppression/${id}`)).status).toBe(400);
    expect((await del(`/api/suppression/${id}`, { reason: 'ok' })).status).toBe(400); // too short to be a reason
    expect(await suppressionValues()).toContain(value); // still there

    const res = await del(`/api/suppression/${id}`, { reason: 'Asked to hear from us again, in writing.' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: value });
    expect(await suppressionValues()).not.toContain(value);
    const audit = await sql("select actor, data from audit_log where action = 'suppression.removed' and data ->> 'value' = $1", [value]);
    expect(audit.rows).toEqual([{ actor: 'founder', data: { value, reason: 'Asked to hear from us again, in writing.', originalReason: 'Unsubscribed.' } }]);
  });

  it('answers 404 for an unknown entry, a malformed id, and another workspace\'s entry', async () => {
    expect((await del(`/api/suppression/${randomUUID()}`, { reason: 'because I said so' })).status).toBe(404);
    expect((await del('/api/suppression/not-a-uuid', { reason: 'because I said so' })).status).toBe(404);
    const theirs = await db.withOwner(async (c) => {
      const w = await c.query("insert into workspaces (name, slug) values ('Other', $1) returning id", [`other-${uniq()}`]);
      return (await c.query("insert into suppression (workspace_id, value) values ($1, 'theirs@other.test') returning id", [w.rows[0].id])).rows[0].id as string;
    });
    expect((await del(`/api/suppression/${theirs}`, { reason: 'because I said so' })).status).toBe(404);
    expect(await suppressionValues()).not.toContain('theirs@other.test');
  });
});
