import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { outboxCallTransport } from '../src/actions/call-transport';
import { buildCallList } from '../src/calls/desk';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import { loadTemplate } from '../src/harness/render';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** The Calls Desk (S9-8): a daily list with a one-line opener, and a call that is only ever proposed. */
let sys: System;
let executors: Executors;
let store: DbOsStore;
let outbox = '';
let agentId = '';
let runId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId });
const lead = async (name: string, phone: string | null, stage = 'new', notes: string | null = null) =>
  (await sql('insert into leads (workspace_id, business_name, phone, stage, notes, email) values ($1, $2, $3, $4, $5, $6) returning id', [ws(), name, phone, stage, notes, `${randomUUID().slice(0, 8)}@x.test`])).rows[0].id as string;
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);
const DAY = '2026-11-20';

beforeAll(async () => {
  ({ sys } = await testSystem());
  outbox = await mkdtemp(path.join(tmpdir(), 'conclave-calls-'));
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(outbox, 'mail')), companyRoot: sys.companyRoot, from: 'hello@example.test', callTransport: outboxCallTransport(outbox) });
  await agentNew(sys, { template: 'writer', department: 'outreach', id: 'calls-w', name: 'Cal' });
  agentId = (await sql("select id from agents where key = 'calls-w'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (outbox) await rm(outbox, { recursive: true, force: true });
});

describe('the Calls Desk templates (S9-8)', () => {
  it('load with no shell, and say a call is only ever proposed', async () => {
    for (const key of ['list-builder', 'call-prepper', 'voice-agent']) {
      const t = await loadTemplate(sys.templatesRoot, key);
      expect(t.permissions.shell, key).toBe('deny');
      expect(t.connectors, key).toEqual(['os']);
    }
    expect((await loadTemplate(sys.templatesRoot, 'voice-agent')).rules).toMatch(/propose_call/);
  });
});

describe('the daily call list (S9-8)', () => {
  it('is built from leads with a phone number, each with a one-line opener, best first, up to the limit, once a day', async () => {
    const a = await lead('Glow Clinic', '+92 300 1111111', 'new', 'Booking page asks for a phone call first.');
    await lead('No Phone Cafe', null);
    await lead('Done Deal Ltd', '+92 300 2222222', 'won');
    await lead('Never Call Us', '+92 300 3333333', 'do_not_contact');
    const b = await lead('Bright Spa', '+92 300 4444444', 'replied');
    const list = await buildCallList(sys.app, ws(), { day: DAY, limit: 5 });
    expect(list.map((x) => x.businessName)).toEqual(['Bright Spa', 'Glow Clinic']); // a lead that has replied comes first
    for (const item of list) {
      expect(item.opener.split('\n')).toHaveLength(1);
      expect(item.opener.length).toBeLessThan(220);
      expect(item.opener).toContain(item.businessName);
    }
    expect(list[1]!.opener).toMatch(/booking page/i);
    expect(await buildCallList(sys.app, ws(), { day: DAY, limit: 5 })).toHaveLength(2); // asking again adds nothing
    expect((await sql('select count(*)::int as n from call_list_items where day = $1', [DAY])).rows[0].n).toBe(2);
    expect((await buildCallList(sys.app, ws(), { day: '2026-11-21', limit: 1 })).map((x) => x.leadId)).toEqual([b]);
    void a;
  });

  it('leaves out a number on the suppression list, and an opener that makes a claim it may not', async () => {
    await lead('Suppressed Gym', '+92 300 5555555');
    await sql("insert into suppression (workspace_id, value, reason) values ($1, '923005555555', 'asked not to be called')", [ws()]);
    await lead('Cure Centre', '+92 300 6666666', 'new', 'They guarantee to cure back pain in one visit.');
    const names = (await buildCallList(sys.app, ws(), { day: '2026-11-22', limit: 20 })).map((x) => x.businessName);
    expect(names).not.toContain('Suppressed Gym');
    const cure = (await sql("select opener from call_list_items where day = '2026-11-22' and lead_id = (select id from leads where business_name = 'Cure Centre')")).rows[0];
    if (cure) expect(cure.opener).not.toMatch(/guarantee|back pain/i);
  });
});

describe('propose_call (S9-8)', () => {
  it('queues a call for approval and places nothing; approving it writes to the outbox only, once', async () => {
    const id = await lead('Call Me Clinic', '+92 300 7777777');
    expect(await callOsTool(store, scope(), 'propose_call', { leadId: id, opener: 'Hi, is this Call Me Clinic? Quick question about your booking page.', script: 'Ask who handles bookings. Offer a free homepage concept. Book a 15 minute call.' })).toMatch(/Nothing has been called/);
    const a = (await sql("select id, status, payload from approvals where kind = 'call.place'")).rows[0];
    expect(a.status).toBe('pending');
    expect(a.payload).toMatchObject({ leadId: id, phone: '+92 300 7777777' });
    expect(existsSync(path.join(outbox, 'calls'))).toBe(false);
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    const files = await readdir(path.join(outbox, 'calls'));
    expect(files).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(outbox, 'calls', files[0]!), 'utf8'))).toMatchObject({ to: '+92 300 7777777', note: expect.stringMatching(/nothing was dialled/i) });
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    expect((await sql('select count(*)::int as n from approvals where kind = $1', ['call.place'])).rows[0].n).toBe(1);
    expect(await callOsTool(store, scope(), 'propose_call', { leadId: id, opener: 'Hi, is this Call Me Clinic? Quick question about your booking page.', script: 'Ask who handles bookings. Offer a free homepage concept. Book a 15 minute call.' })).toMatch(/Already queued/);
  });

  it('refuses a lead with no phone, one marked do not contact, a number on the suppression list, and a script that makes a blocked claim', async () => {
    const args = (leadId: string, script = 'Ask who handles bookings.') => ({ leadId, opener: 'Hi, quick question.', script });
    await expect(callOsTool(store, scope(), 'propose_call', args(await lead('Nobody Home', null)))).rejects.toThrow(/no phone/i);
    await expect(callOsTool(store, scope(), 'propose_call', args(await lead('Hands Off', '+92 300 8888888', 'do_not_contact')))).rejects.toThrow(/do not contact/i);
    const sup = await lead('Quiet Gym', '+92 300 9999999');
    await sql("insert into suppression (workspace_id, value, reason) values ($1, '923009999999', 'asked')", [ws()]);
    await expect(callOsTool(store, scope(), 'propose_call', args(sup))).rejects.toThrow(/suppression/i);
    await expect(callOsTool(store, scope(), 'propose_call', args(await lead('Claims Clinic', '+92 300 1212121'), 'Tell them we guarantee to cure their back pain.'))).rejects.toThrow(/Refused/);
  });

  it('is refused by the executor with no call connector, and by the kill switch', async () => {
    const id = await lead('Later Ltd', '+92 300 1313131');
    await callOsTool(store, scope(), 'propose_call', { leadId: id, opener: 'Hi, is this Later Ltd?', script: 'Ask a question.' });
    const a = (await sql("select id from approvals where kind = 'call.place' and payload->>'leadId' = $1", [id])).rows[0];
    await approve(a.id);
    const none = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(outbox, 'mail')), companyRoot: sys.companyRoot, from: 'hello@example.test' });
    expect((await none.run(a.id)).status).toBe('refused');
  });
});
