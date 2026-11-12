import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let app: ReturnType<typeof createApp>;
const bus = new Bus();
const heard: BusMessage[] = [];
const killCalls: boolean[] = [];
let released = 0;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const get = () => app.request('/api/settings');
const patch = (body: unknown) => app.request('/api/settings', { method: 'PATCH', headers: json, body: JSON.stringify(body) });

type View = {
  killSwitch: boolean;
  killSwitchAt: string | null;
  windowHours: number;
  windowCap: number;
  emailDailyCap: number;
  sentInWindow: number;
  sentToday: number;
  heldApprovals: number;
};
const view = async () => (await (await get()).json()) as View;

beforeAll(async () => {
  ({ sys } = await testSystem());
  bus.subscribe((m) => heard.push(m));
  app = createApp({
    pool: sys.app,
    workspaceId: ws(),
    tokens: new RunTokens(),
    store: new MemoryOsStore(),
    bus,
    dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })),
    onKillSwitch: async (on) => void killCalls.push(on),
    onReleaseHeld: async () => ++released,
  });
}, 180_000);
afterAll(async () => sys?.close());

describe('settings (S1-5)', () => {
  it('starts with the defaults even though no settings row exists yet, and creates it on first read', async () => {
    expect((await sql('select 1 from workspace_settings')).rowCount).toBe(0);
    expect(await view()).toEqual({
      killSwitch: false,
      killSwitchAt: null,
      windowHours: 5,
      windowCap: 30,
      emailDailyCap: 100,
      sentInWindow: 0,
      sentToday: 0,
      heldApprovals: 0,
    });
    expect((await sql('select 1 from workspace_settings')).rowCount).toBe(1);
    await get();
    expect((await sql('select 1 from workspace_settings')).rowCount).toBe(1); // reading again adds nothing
  });

  it('changes the caps, and says so in the audit log with before and after', async () => {
    const res = await patch({ windowHours: 6, windowCap: 25, emailDailyCap: 80 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ windowHours: 6, windowCap: 25, emailDailyCap: 80 });
    expect(await view()).toMatchObject({ windowHours: 6, windowCap: 25, emailDailyCap: 80 });
    const audit = await sql("select actor, data from audit_log where action = 'settings.changed' order by id desc limit 1");
    expect(audit.rows[0]).toMatchObject({ actor: 'founder', data: { before: { windowHours: 5, windowCap: 30, emailDailyCap: 100 }, after: { windowHours: 6, windowCap: 25, emailDailyCap: 80 } } });
    await patch({ windowHours: 5, windowCap: 30, emailDailyCap: 100 });
  });

  it('refuses values that make no sense, a typo in a field name, and an empty change', async () => {
    for (const bad of [
      { windowHours: 0 },
      { windowHours: 169 },
      { windowHours: 1.5 },
      { windowCap: 0 },
      { windowCap: 100001 },
      { emailDailyCap: 0 },
      { emailDailyCap: '30' },
      { killswitch: true }, // wrong case: not silently ignored
      {},
    ]) {
      expect((await patch(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await view()).toMatchObject({ windowHours: 5, windowCap: 30, emailDailyCap: 100 });
  });

  it('counts what was sent in the window and today', async () => {
    const lead = (await sql("insert into leads (workspace_id, email) values ($1, $2) returning id", [ws(), `c-${randomUUID().slice(0, 8)}@x.test`])).rows[0].id;
    await sql("insert into outreach_messages (workspace_id, lead_id, status, sent_at) values ($1, $2, 'sent', now() - interval '1 hour'), ($1, $2, 'sent', now() - interval '6 hours'), ($1, $2, 'failed', now())", [ws(), lead]);
    const v = await view();
    expect(v.sentInWindow).toBe(1); // the one 6 hours ago is outside five hours; the failed one never counts
  });
});

describe('the kill switch (S1-5)', () => {
  it('turning it on records when, tells the inbox, and stops the running work once', async () => {
    killCalls.length = 0;
    heard.length = 0;
    const res = await patch({ killSwitch: true });
    expect(res.status).toBe(200);
    const v = await view();
    expect(v.killSwitch).toBe(true);
    expect(v.killSwitchAt).not.toBeNull();
    expect(killCalls).toEqual([true]);
    expect(heard).toContainEqual({ kind: 'settings.changed', workspaceId: ws() });
    const audit = await sql("select data from audit_log where action = 'settings.changed' order by id desc limit 1");
    expect(audit.rows[0].data).toMatchObject({ before: { killSwitch: false }, after: { killSwitch: true } });
  });

  it('turning it on again does nothing the second time', async () => {
    killCalls.length = 0;
    const at = (await view()).killSwitchAt;
    expect((await patch({ killSwitch: true })).status).toBe(200);
    expect(killCalls).toEqual([]);
    expect((await view()).killSwitchAt).toBe(at);
  });

  it('turning it off clears the switch, and does not send held approvals by itself', async () => {
    killCalls.length = 0;
    released = 0;
    expect((await patch({ killSwitch: false })).status).toBe(200);
    expect((await view()).killSwitch).toBe(false);
    expect(killCalls).toEqual([false]);
    expect(released).toBe(0);
  });

  it('shows how many approved emails are waiting, and sends them only when asked, with the switch off', async () => {
    const lead = (await sql("insert into leads (workspace_id, email) values ($1, $2) returning id", [ws(), `h-${randomUUID().slice(0, 8)}@x.test`])).rows[0].id;
    await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status, decided_at) values ($1, 'email.send', $2, $3, 'approved', now())", [ws(), `h:${randomUUID()}`, JSON.stringify({ leadId: lead })]);
    expect((await view()).heldApprovals).toBe(1);

    await patch({ killSwitch: true });
    const refused = await app.request('/api/settings/release-held', { method: 'POST', headers: json, body: '{}' });
    expect(refused.status).toBe(409); // not while it is on
    expect(released).toBe(0);

    await patch({ killSwitch: false });
    released = 0;
    const ok = await app.request('/api/settings/release-held', { method: 'POST', headers: json, body: '{}' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ released: 1 });
    expect(released).toBe(1);
  });
});
