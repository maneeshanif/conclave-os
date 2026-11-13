import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { loadCompany } from '../src/company/loader';
import { syncCompany } from '../src/company/sync';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
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

beforeAll(async () => {
  ({ sys } = await testSystem());
  await syncCompany(sys.app, ws(), await loadCompany(sys.companyRoot));
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
  await agentNew(sys, { template: 'outreach-rep', department: 'outreach', id: 'rep-r', autonomy: 2 });
  repId = (await sql("select id from agents where key = 'rep-r'")).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from sequence_enrollments');
  await sql('delete from thread_messages');
  await sql('delete from threads');
  await sql('delete from outreach_messages');
  await sql('delete from deal_stage_events');
  await sql('delete from projects');
  await sql("delete from run_events");
  await sql('delete from runs');
  await sql("delete from tasks where created_by = 'system'");
  await sql('delete from deals');
  await sql('delete from contacts');
  await sql('update leads set account_id = null');
  await sql('delete from accounts');
  await sql('delete from sequence_steps');
  await sql('delete from campaigns');
  await sql('delete from channel_accounts');
});

const newLead = async (name: string) =>
  (await sql('insert into leads (workspace_id, business_name, email) values ($1, $2, $3) returning id', [ws(), name, `${name.toLowerCase().replace(/\W/g, '')}-${randomUUID().slice(0, 5)}@x.test`])).rows[0].id as string;

describe('campaign results (S2-6)', () => {
  async function setup() {
    const mb = (await ok<{ id: string }>(await call('POST', '/channel-accounts', { channel: 'email', handle: `m-${randomUUID().slice(0, 6)}@example.test` }), 201)).id;
    const { id } = await ok<{ id: string }>(await call('POST', '/campaigns', { name: 'Clinics', channel: 'email', channelAccountId: mb }), 201);
    await call('PUT', `/campaigns/${id}/steps`, { steps: [{ step: 1, waitDays: 0 }, { step: 2, waitDays: 3 }] });
    await call('POST', `/campaigns/${id}/approve`, {});
    await call('POST', `/campaigns/${id}/start`, {});
    const [a, b, c, d] = [await newLead('Alpha'), await newLead('Beta'), await newLead('Gamma'), await newLead('Delta')];
    await call('POST', `/campaigns/${id}/enroll`, { leadIds: [a, b, c, d] });
    const sent = (lead: string, when = 'now()') => sql(`insert into outreach_messages (workspace_id, lead_id, channel, to_address, status, sent_at, campaign_id, channel_account_id) values ($1, $2, 'email', 'x@y.test', 'sent', ${when}, $3, $4)`, [ws(), lead, id, mb]);
    return { id, mb, a, b, c, d, sent };
  }
  const results = async (id: string) => ok<Record<string, unknown>>(await call('GET', `/campaigns/${id}/results`));

  it('counts sent, replied, positive replies and the state of the list, from the tables', async () => {
    const { id, a, b, c, sent } = await setup();
    await sent(a);
    await sent(b);
    await sent(c);
    for (const [lead, body] of [[a, 'Interested!'], [a, 'Also, Tuesday works.'], [b, 'Not now.']] as const) await call('POST', `/leads/${lead}/inbound`, { body });
    const msgs = (await sql("select m.id, t.lead_id from thread_messages m join threads t on t.id = m.thread_id where m.direction = 'in' order by m.at")).rows;
    for (const m of msgs.filter((x) => x.lead_id === a)) await call('POST', `/thread-messages/${m.id}/classify`, { classification: 'positive' });
    await call('POST', `/thread-messages/${msgs.find((x) => x.lead_id === b)!.id}/classify`, { classification: 'negative' });
    const r = await results(id);
    expect(r).toMatchObject({ enrolled: 4, sent: 3, replied: 2, positive_replies: 1 }); // two positive messages from one lead count once
    expect(r.reply_rate).toBeCloseTo(2 / 3, 5);
    expect(r.enrollment).toMatchObject({ active: 2, paused: 2, unsubscribed: 0, done: 0 });
  });

  it('does not count a reply that came before anything was sent in this campaign', async () => {
    const { id, a, sent } = await setup();
    await call('POST', `/leads/${a}/inbound`, { body: 'Hello out of the blue.' });
    await sent(a, "now() + interval '1 minute'");
    expect(await results(id)).toMatchObject({ sent: 1, replied: 0 });
  });

  it('counts won deals of enrolled leads once, and says what it cannot know', async () => {
    const { id, a, sent } = await setup();
    await sent(a);
    const p = await ok<{ dealId: string }>(await call('POST', `/leads/${a}/promote`, {}), 201);
    await call('POST', `/deals/${p.dealId}/stage`, { stage: 'first-priced-outcome' });
    await call('PATCH', `/deals/${p.dealId}`, { decisionMaker: 'Dana', due: '2026-12-01' });
    await call('POST', `/deals/${p.dealId}/stage`, { stage: 'deliver' });
    await call('POST', `/deals/${p.dealId}/stage`, { stage: 'retainer' });
    const r = await results(id);
    expect(r.won).toBe(1);
    // Nothing in the tables says whether an email arrived or was opened, or that a meeting was booked, so those are null, not zero.
    expect(r.delivered).toBeNull();
    expect(r.opened).toBeNull();
    expect(r.meetings).toBeNull();
  });

  it('adds up what the step tasks cost to run', async () => {
    const { id, a } = await setup();
    const t = (await sql("insert into tasks (workspace_id, title, body, kind, created_by, assignee_id) values ($1, 's', $2, 'sequence_step', 'system', $3) returning id", [ws(), `x (campaign ${id}, lead ${a})`, repId])).rows[0].id;
    await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status, cost_usd) values ($1, $2, $3, 'task_assigned', 'claude-cli', 'succeeded', 0.25), ($1, $2, $3, 'task_assigned', 'claude-cli', 'succeeded', 0.5)", [ws(), repId, t]);
    expect(Number((await results(id)).cost_usd)).toBeCloseTo(0.75, 5);
  });

  it('is empty, not an error, for a campaign nothing has happened in; 404 for an unknown one', async () => {
    const { id } = await setup();
    expect(await results(id)).toMatchObject({ sent: 0, replied: 0, positive_replies: 0, won: 0, reply_rate: null });
    expect((await call('GET', `/campaigns/${randomUUID()}/results`)).status).toBe(404);
  });
});

describe('the pipeline (S2-6)', () => {
  type Stage = { key: string; position: number; current: number; reached: number; conversion: number | null; avg_days: number | null; median_days: number | null };
  type Pipeline = { funnel: string; stages: Stage[]; totals: { open: number; won: number; lost: number }; stuck: { deal_id: string; stage: string; days_in_stage: number; missing: string[]; account: string }[] };
  const pipeline = async (q = '?funnel=services') => ok<Pipeline>(await call('GET', `/pipeline${q}`));
  const deal = async (name: string) => {
    const { id: accountId } = await ok<{ id: string }>(await call('POST', '/accounts', { name }), 201);
    return (await ok<{ id: string }>(await call('POST', '/deals', { accountId, funnel: 'services', offer: name }), 201)).id;
  };
  const move = (id: string, stage: string) => call('POST', `/deals/${id}/stage`, { stage });
  const stage = (p: Pipeline, key: string) => p.stages.find((s) => s.key === key)!;

  it('gives exact counts and conversion by stage for a known set of deals', async () => {
    const [a, b, c, d] = [await deal('A'), await deal('B'), await deal('C'), await deal('D')];
    await move(a, 'signal');
    await move(a, 'first-touch');
    await move(b, 'signal');
    await move(d, 'first-priced-outcome'); // skips ahead
    await call('PATCH', `/deals/${d}`, { decisionMaker: 'Dana', due: '2026-12-01' });
    await move(d, 'deliver'); // won
    const p = await pipeline();
    expect(p.funnel).toBe('services');
    expect(p.stages.map((s) => s.key)).toHaveLength(9);
    expect(stage(p, 'target')).toMatchObject({ current: 1, reached: 4 }); // C stayed
    expect(stage(p, 'signal')).toMatchObject({ current: 1, reached: 3 }); // B; A, B and D got at least this far
    expect(stage(p, 'first-touch')).toMatchObject({ current: 1, reached: 2 }); // A; A and D
    expect(stage(p, 'first-priced-outcome')).toMatchObject({ current: 0, reached: 1 });
    expect(stage(p, 'deliver')).toMatchObject({ current: 1, reached: 1 });
    expect(stage(p, 'retainer')).toMatchObject({ reached: 0, conversion: null });
    expect(stage(p, 'target').conversion).toBeCloseTo(3 / 4, 5);
    expect(stage(p, 'signal').conversion).toBeCloseTo(2 / 3, 5);
    expect(p.totals).toEqual({ open: 3, won: 1, lost: 0 });
    void c;
  });

  it('changes when a deal moves, and counts a deal that went back only once', async () => {
    const [a, c] = [await deal('A'), await deal('C')];
    await move(a, 'signal');
    await move(a, 'first-touch');
    await move(a, 'signal'); // back
    let p = await pipeline();
    expect(stage(p, 'first-touch')).toMatchObject({ current: 0, reached: 1 }); // it did get there, once
    expect(stage(p, 'signal')).toMatchObject({ current: 1, reached: 1 });
    await move(c, 'signal');
    p = await pipeline();
    expect(stage(p, 'signal')).toMatchObject({ current: 2, reached: 2 });
  });

  it('measures days in each stage from the recorded moves, including the stage a deal is still in', async () => {
    const a = await deal('A');
    await move(a, 'signal');
    await move(a, 'first-touch');
    // target for 6 days, signal for 3 days, first-touch for 1 day so far.
    await sql("update deals set created_at = now() - interval '10 days', stage_changed_at = now() - interval '1 day' where id = $1", [a]);
    await sql("update deal_stage_events set at = now() - interval '4 days' where deal_id = $1 and to_stage = 'signal'", [a]);
    await sql("update deal_stage_events set at = now() - interval '1 day' where deal_id = $1 and to_stage = 'first-touch'", [a]);
    const p = await pipeline();
    expect(stage(p, 'target').avg_days).toBeCloseTo(6, 1);
    expect(stage(p, 'signal').avg_days).toBeCloseTo(3, 1);
    expect(stage(p, 'first-touch').avg_days).toBeCloseTo(1, 1);
    expect(stage(p, 'signal').median_days).toBeCloseTo(3, 1);
    expect(stage(p, 'deliver').avg_days).toBeNull();
  });

  it('flags a deal stuck in a stage, and says what it is waiting for', async () => {
    const fresh = await deal('Fresh');
    const old = await deal('Old');
    await move(old, 'first-priced-outcome');
    await sql("update deals set stage_changed_at = now() - interval '20 days' where id = $1", [old]);
    const p = await pipeline();
    expect(p.stuck.map((s) => s.deal_id)).toEqual([old]);
    expect(p.stuck[0]).toMatchObject({ stage: 'first-priced-outcome', account: 'Old' });
    expect(p.stuck[0]!.days_in_stage).toBeGreaterThanOrEqual(20);
    expect(p.stuck[0]!.missing.sort()).toEqual(['decision_maker', 'due']);
    expect((await pipeline('?funnel=services&stuckDays=30')).stuck).toEqual([]);
    expect((await pipeline('?funnel=services&stuckDays=0')).stuck.map((s) => s.deal_id).sort()).toEqual([fresh, old].sort());
  });

  it('keeps won and lost deals out of the stuck list, and counts them in the totals', async () => {
    const lost = await deal('Lost');
    await sql("update deals set stage_changed_at = now() - interval '40 days' where id = $1", [lost]);
    await call('POST', `/deals/${lost}/lose`, { reason: 'No budget.' });
    const p = await pipeline();
    expect(p.stuck).toEqual([]);
    expect(p.totals).toEqual({ open: 0, won: 0, lost: 1 });
  });

  it('refuses an unknown funnel and a silly threshold, and lists the funnels when none is named', async () => {
    expect((await call('GET', '/pipeline?funnel=nope')).status).toBe(404);
    expect((await call('GET', '/pipeline?funnel=services&stuckDays=-1')).status).toBe(400);
    const all = await ok<{ funnel: string }[]>(await call('GET', '/pipeline'));
    expect(all.map((f) => f.funnel).sort()).toEqual(['product', 'services']);
  });
});
