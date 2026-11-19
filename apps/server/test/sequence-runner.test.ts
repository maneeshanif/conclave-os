import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { runSequences } from '../src/workflows/sequences';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let app: ReturnType<typeof createApp>;
let repId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const call = (method: string, p: string, body?: unknown) => app.request(`/api${p}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
const ok = async <T>(res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};
const run = (now = new Date()) => runSequences({ pool: sys.app, workspaceId: ws(), now: () => now });

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
  await agentNew(sys, { template: 'outreach-rep', department: 'outreach', id: 'seq-rep', autonomy: 2 });
  repId = (await sql("select id from agents where key = 'seq-rep'")).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  await sql('delete from sequence_enrollments');
  await sql('delete from thread_messages');
  await sql('delete from threads');
  await sql('delete from outreach_messages');
  await sql("delete from tasks where created_by = 'system'");
  await sql("update approvals set status = 'failed' where status in ('pending','approved','executing')");
  await sql("delete from approvals where kind = 'email.send'");
  await sql('delete from suppression');
  await sql('delete from sequence_steps');
  await sql('delete from campaigns');
  await sql('delete from channel_accounts');
});

const lead = async (over: { email?: string | null; stage?: string; name?: string } = {}) =>
  (await sql('insert into leads (workspace_id, business_name, email, stage) values ($1, $2, $3, $4) returning id', [ws(), over.name ?? 'Glow Clinic', over.email === undefined ? `d-${randomUUID().slice(0, 8)}@glow.test` : over.email, over.stage ?? 'new'])).rows[0].id as string;

async function campaign(opts: { cap?: number; running?: boolean; steps?: { step: number; waitDays: number }[] } = {}) {
  const mb = (await ok<{ id: string }>(await call('POST', '/channel-accounts', { channel: 'email', handle: `m-${randomUUID().slice(0, 6)}@example.test`, dailyCap: opts.cap ?? 10 }), 201)).id;
  const { id } = await ok<{ id: string }>(await call('POST', '/campaigns', { name: 'Clinics', channel: 'email', channelAccountId: mb }), 201);
  await ok(await call('PUT', `/campaigns/${id}/steps`, { steps: opts.steps ?? [{ step: 1, waitDays: 0, skill: 'clinic-homepage-outreach' }, { step: 2, waitDays: 3, skill: 'follow-up' }] }));
  await ok(await call('POST', `/campaigns/${id}/approve`, {}));
  if (opts.running !== false) await ok(await call('POST', `/campaigns/${id}/start`, {}));
  return { id, mb };
}
const enroll = async (id: string, n: number) => {
  const leads: string[] = [];
  for (let i = 0; i < n; i++) leads.push(await lead({ name: `Clinic ${i + 1}` }));
  await ok(await call('POST', `/campaigns/${id}/enroll`, { leadIds: leads }));
  // Enrolled in order, so "oldest first" is the order given.
  for (const [i, l] of leads.entries()) await sql("update sequence_enrollments set created_at = now() - make_interval(secs => $2) where lead_id = $1", [l, 100 - i]);
  return leads;
};
const stepTasks = async () => (await sql("select id, title, body, assignee_id, status from tasks where kind = 'sequence_step' order by created_at, title")).rows;
const enrollment = async (leadId: string) => (await sql('select status, paused_reason, steps_sent, requested_step from sequence_enrollments where lead_id = $1', [leadId])).rows[0];

describe('the sequence runner (S2-5)', () => {
  it('turns due first steps into tasks for the outreach agent, up to the mailbox cap and no more', async () => {
    const { id } = await campaign({ cap: 3 });
    await enroll(id, 5);
    const r = await run();
    expect(r.created).toBe(3);
    const tasks = await stepTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks.every((t) => t.assignee_id === repId && t.status === 'todo')).toBe(true);
    expect(tasks.map((t) => t.title)).toEqual(['Step 1 of "Clinics": Clinic 1', 'Step 1 of "Clinics": Clinic 2', 'Step 1 of "Clinics": Clinic 3']); // oldest enrolments first
    expect(tasks[0].body).toMatch(/propose_email/);
    expect(tasks[0].body).toMatch(/clinic-homepage-outreach/);
  });

  it('counts what the mailbox already sent today and what is already on its way', async () => {
    const { id, mb } = await campaign({ cap: 4 });
    const leads = await enroll(id, 6);
    await sql("insert into outreach_messages (workspace_id, lead_id, channel, to_address, status, sent_at, channel_account_id) values ($1, $2, 'email', 'x@y.test', 'sent', now(), $3)", [ws(), leads[5], mb]);
    await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status) values ($1, 'email.send', $2, $3, 'pending')", [ws(), `x:${randomUUID()}`, JSON.stringify({ leadId: leads[4], campaignId: id })]);
    expect((await run()).created).toBe(2); // 4 - 1 sent - 1 waiting for approval
  });

  it('makes no duplicates when run again, or run three times at once', async () => {
    const { id } = await campaign({ cap: 10 });
    await enroll(id, 4);
    await Promise.all([run(), run(), run()]);
    expect(await stepTasks()).toHaveLength(4);
    expect((await run()).created).toBe(0);
    expect(await stepTasks()).toHaveLength(4);
  });

  it('waits the days a step asks for, counted from the last send', async () => {
    const { id } = await campaign();
    const [l] = await enroll(id, 1);
    await sql("update sequence_enrollments set steps_sent = 1, requested_step = 1, last_sent_at = now() - interval '2 days 23 hours' where lead_id = $1", [l]);
    expect((await run()).created).toBe(0);
    await sql("update sequence_enrollments set last_sent_at = now() - interval '3 days 1 minute' where lead_id = $1", [l]);
    expect((await run()).created).toBe(1);
    expect((await stepTasks())[0].title).toMatch(/^Step 2 of/);
    expect((await enrollment(l!)).requested_step).toBe(2);
  });

  it('marks an enrolment done when it has had every step', async () => {
    const { id } = await campaign();
    const [l] = await enroll(id, 1);
    await sql("update sequence_enrollments set steps_sent = 2, requested_step = 2, last_sent_at = now() - interval '9 days' where lead_id = $1", [l]);
    expect((await run()).created).toBe(0);
    expect((await enrollment(l!)).status).toBe('done');
  });

  it('gives nothing to a lead who replied, asked to stop, is do-not-contact, lost its address, or was suppressed since', async () => {
    const { id } = await campaign({ cap: 20 });
    const [replied, stopped, dnc, noEmail, suppressed, fine] = await enroll(id, 6);
    await sql("update sequence_enrollments set status = 'paused', paused_reason = 'replied' where lead_id = $1", [replied]);
    await sql("update sequence_enrollments set status = 'unsubscribed' where lead_id = $1", [stopped]);
    await sql("update leads set stage = 'do_not_contact' where id = $1", [dnc]);
    await sql('update leads set email = null where id = $1', [noEmail]);
    await sql("insert into suppression (workspace_id, value, reason) select $1, upper(email), 'asked' from leads where id = $2", [ws(), suppressed]);
    const r = await run();
    expect(r.created).toBe(1);
    expect((await stepTasks())[0].body).toContain(fine!);
  });

  it('does nothing for a campaign that is not running, or while the kill switch is on', async () => {
    const draftish = await campaign({ running: false });
    await enroll(draftish.id, 2);
    expect((await run()).created).toBe(0); // approved but not started
    await ok(await call('POST', `/campaigns/${draftish.id}/start`, {}));
    await sql('update workspace_settings set kill_switch = 1');
    expect((await run()).created).toBe(0);
    await sql('update workspace_settings set kill_switch = 0');
    await ok(await call('POST', `/campaigns/${draftish.id}/pause`, {}));
    expect((await run()).created).toBe(0);
    await ok(await call('POST', `/campaigns/${draftish.id}/start`, {}));
    expect((await run()).created).toBe(2);
  });

  it('does not ask again for a step the founder rejected, and pauses that lead instead of clogging', async () => {
    const { id } = await campaign();
    const [l] = await enroll(id, 1);
    await run();
    await sql("update tasks set status = 'done' where kind = 'sequence_step'");
    await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status) values ($1, 'email.send', $2, $3, 'rejected')", [ws(), `email:${l}:1`, JSON.stringify({ leadId: l, campaignId: id })]);
    expect((await run()).created).toBe(0);
    expect(await enrollment(l!)).toMatchObject({ status: 'paused', paused_reason: 'step 1 was rejected' });
  });

  it('asks again when the step\'s task was cancelled, or finished without any proposal', async () => {
    const { id } = await campaign();
    const [a, b] = await enroll(id, 2);
    await run();
    await sql("update tasks set status = 'cancelled' where body like '%' || $1 || '%'", [a]);
    await sql("update tasks set status = 'done' where body like '%' || $1 || '%'", [b]);
    expect((await run()).created).toBe(2);
  });

  it('is available on demand through the API', async () => {
    const { id } = await campaign();
    await enroll(id, 2);
    expect(await ok(await call('POST', '/run-sequences', {}))).toMatchObject({ created: 2 });
  });
});
