import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeEmail, type ExecutorDeps } from '../src/actions/email';
import type { EmailTransport, OutgoingEmail } from '../src/actions/transport';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

class CountingTransport implements EmailTransport {
  name = 'counting';
  sent: OutgoingEmail[] = [];
  async send(m: OutgoingEmail) {
    this.sent.push(m);
    return { ref: `counting:${m.id}` };
  }
}

let sys: System;
let app: ReturnType<typeof createApp>;
let companyRoot: string;
let agentId = '';
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
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-camp-co-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), '# Test Co\n\n## Cold email footer\nTest Co, 12 Main Street, Lahore 54000, Pakistan\n');
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
  await agentNew(sys, { template: 'outreach-rep', department: 'outreach', id: 'camp-rep', autonomy: 2 });
  agentId = (await sql("select id from agents where key = 'camp-rep'")).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0, email_daily_cap = 100000, window_hours = 5, window_cap = 100000', [ws()]);
  await sql("update approvals set status = 'failed' where kind = 'email.send' and status in ('approved','executing','pending')");
  await sql('delete from outreach_messages');
  await sql('delete from sequence_steps');
  await sql('delete from campaigns');
  await sql('delete from channel_accounts');
});

const mailbox = (over: Record<string, unknown> = {}) => call('POST', '/channel-accounts', { channel: 'email', handle: `hello-${randomUUID().slice(0, 6)}@example.test`, dailyCap: 10, ...over });
const newMailbox = async (over: Record<string, unknown> = {}) => (await ok<{ id: string }>(await mailbox(over), 201)).id;
const STEPS = [
  { step: 1, waitDays: 0, skill: 'clinic-homepage-outreach' },
  { step: 2, waitDays: 3, skill: 'follow-up' },
];
async function newCampaign(over: Record<string, unknown> = {}, state: 'draft' | 'approved' | 'running' | 'paused' = 'running') {
  const channelAccountId = (over.channelAccountId as string | undefined) ?? (await newMailbox());
  const { id } = await ok<{ id: string }>(await call('POST', '/campaigns', { name: 'Clinics Lahore', market: 'services', channel: 'email', channelAccountId, ...over }), 201);
  if (state === 'draft') return { id, channelAccountId };
  await ok(await call('PUT', `/campaigns/${id}/steps`, { steps: STEPS }));
  await ok(await call('POST', `/campaigns/${id}/approve`, {}));
  if (state !== 'approved') await ok(await call('POST', `/campaigns/${id}/start`, {}));
  if (state === 'paused') await ok(await call('POST', `/campaigns/${id}/pause`, {}));
  return { id, channelAccountId };
}

describe('channel accounts (S2-3)', () => {
  it('registers a mailbox with its own daily cap and lists it', async () => {
    const id = await newMailbox({ handle: 'Hello@Example.test', dailyCap: 25 });
    const list = await ok<{ id: string; handle: string; daily_cap: number; health: string }[]>(await call('GET', '/channel-accounts'));
    expect(list).toEqual([expect.objectContaining({ id, handle: 'hello@example.test', daily_cap: 25, health: 'ok' })]);
  });

  it('refuses a duplicate handle, a silly cap, a bad channel and a bad health', async () => {
    await newMailbox({ handle: 'a@example.test' });
    expect((await mailbox({ handle: 'A@example.test' })).status).toBe(409);
    expect((await mailbox({ dailyCap: 0 })).status).toBe(400);
    expect((await mailbox({ dailyCap: 100000 })).status).toBe(400);
    expect((await mailbox({ channel: 'carrier-pigeon' })).status).toBe(400);
    const id = await newMailbox();
    expect((await call('PATCH', `/channel-accounts/${id}`, { health: 'great' })).status).toBe(400);
    expect((await call('PATCH', `/channel-accounts/${id}`, { dailyCap: 5, health: 'paused' })).status).toBe(200);
  });
});

describe('campaigns and their sequences (S2-3)', () => {
  it('walks draft, approved, running, paused, done, and logs each change', async () => {
    const { id } = await newCampaign({}, 'draft');
    expect(await ok<{ status: string }>(await call('GET', `/campaigns/${id}`))).toMatchObject({ status: 'draft', steps: [] });
    await ok(await call('PUT', `/campaigns/${id}/steps`, { steps: STEPS }));
    await ok(await call('POST', `/campaigns/${id}/approve`, {}));
    await ok(await call('POST', `/campaigns/${id}/start`, {}));
    expect((await ok<{ status: string }>(await call('GET', `/campaigns/${id}`))).status).toBe('running');
    await ok(await call('POST', `/campaigns/${id}/pause`, {}));
    await ok(await call('POST', `/campaigns/${id}/start`, {})); // resume
    await ok(await call('POST', `/campaigns/${id}/finish`, {}));
    expect((await ok<{ status: string; steps: unknown[] }>(await call('GET', `/campaigns/${id}`))).status).toBe('done');
    const actions = (await sql("select action from audit_log where subject = $1 order by id", [id])).rows.map((r) => r.action);
    expect(actions).toEqual(['campaign.created', 'campaign.approved', 'campaign.started', 'campaign.paused', 'campaign.started', 'campaign.done']);
  });

  it('will not start before the founder has approved it', async () => {
    const { id } = await newCampaign({}, 'draft');
    await ok(await call('PUT', `/campaigns/${id}/steps`, { steps: STEPS }));
    expect((await call('POST', `/campaigns/${id}/start`, {})).status).toBe(409);
  });

  it('will not be approved without steps, with a first step that waits, or on an unhealthy mailbox', async () => {
    const { id, channelAccountId } = await newCampaign({}, 'draft');
    expect((await call('POST', `/campaigns/${id}/approve`, {})).status).toBe(409); // no steps
    expect((await call('PUT', `/campaigns/${id}/steps`, { steps: [{ step: 1, waitDays: 2, skill: 'x' }] })).status).toBe(400);
    expect((await call('PUT', `/campaigns/${id}/steps`, { steps: [{ step: 1, waitDays: 0 }, { step: 3, waitDays: 1 }] })).status).toBe(400); // a gap
    await ok(await call('PUT', `/campaigns/${id}/steps`, { steps: STEPS }));
    await call('PATCH', `/channel-accounts/${channelAccountId}`, { health: 'blocked' });
    expect((await call('POST', `/campaigns/${id}/approve`, {})).status).toBe(409);
  });

  it('freezes the sequence once approved: what was approved is what runs', async () => {
    const { id } = await newCampaign({}, 'approved');
    expect((await call('PUT', `/campaigns/${id}/steps`, { steps: [{ step: 1, waitDays: 0 }] })).status).toBe(409);
  });

  it('refuses a channel account of the wrong channel, or one that does not exist', async () => {
    const dm = await newMailbox({ channel: 'x_dm', handle: '@anees' });
    expect((await call('POST', '/campaigns', { name: 'X', channel: 'email', channelAccountId: dm })).status).toBe(400);
    expect((await call('POST', '/campaigns', { name: 'X', channel: 'email', channelAccountId: randomUUID() })).status).toBe(404);
  });
});

describe('a campaign gates what an agent may propose (S2-3)', () => {
  const propose = async (campaignId: string | undefined) => {
    const lead = (await sql("insert into leads (workspace_id, business_name, email) values ($1, 'Glow', $2) returning id", [ws(), `x${randomUUID().slice(0, 8)}@clinic.test`])).rows[0].id as string;
    const task = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 't', 'in_progress', $2, $2, 'founder') returning id", [ws(), agentId])).rows[0].id as string;
    const run = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId, task])).rows[0].id as string;
    const store = new DbOsStore(sys.app, undefined, companyRoot);
    const result = await callOsTool(store, { workspaceId: ws(), agentId, runId: run, taskId: task }, 'propose_email', { leadId: lead, subject: 'A concept', body: 'Hi, a short note about your booking page.', step: 1, ...(campaignId ? { campaignId } : {}) }).then(
      (r) => ({ ok: true as const, r }),
      (e: Error) => ({ ok: false as const, error: e.message }),
    );
    return { lead, result };
  };

  it('accepts a proposal for a running campaign and records the campaign and mailbox on it', async () => {
    const { id, channelAccountId } = await newCampaign();
    const { lead, result } = await propose(id);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const m = (await sql('select campaign_id, channel_account_id from outreach_messages where lead_id = $1', [lead])).rows[0];
    expect(m).toEqual({ campaign_id: id, channel_account_id: channelAccountId });
  });

  it.each(['draft', 'approved', 'paused'] as const)('refuses a proposal for a %s campaign, and nothing is queued', async (state) => {
    const { id } = await newCampaign({}, state);
    const { lead, result } = await propose(id);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/not running/i);
    expect((await sql('select 1 from approvals where payload ->> \'leadId\' = $1', [lead])).rowCount).toBe(0);
  });

  it('refuses a campaign that does not exist', async () => {
    const { result } = await propose(randomUUID());
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/no such campaign/i);
  });
});

describe('the channel account limits the executor (S2-3)', () => {
  const deps = (t: EmailTransport): ExecutorDeps => ({ pool: sys.app, workspaceId: ws(), transport: t, companyRoot, from: 'Anees <hello@example.test>' });
  async function approved(campaignId: string | null, channelAccountId: string | null) {
    const lead = (await sql("insert into leads (workspace_id, business_name, email) values ($1, 'Clinic', $2) returning id", [ws(), `d${randomUUID().slice(0, 8)}@clinic.test`])).rows[0].id as string;
    const payload = { leadId: lead, to: (await sql('select email from leads where id = $1', [lead])).rows[0].email, subject: 'A concept', body: 'Hi, a short note.', step: 1, ...(campaignId ? { campaignId } : {}) };
    const ap = (await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status, decided_at) values ($1, 'email.send', $2, $3, 'approved', now()) returning id", [ws(), `c:${randomUUID()}`, JSON.stringify(payload)])).rows[0].id as string;
    await sql("insert into outreach_messages (workspace_id, lead_id, approval_id, to_address, subject, body, status, campaign_id, channel_account_id) values ($1, $2, $3, $4, 's', 'b', 'queued', $5, $6)", [ws(), lead, ap, payload.to, campaignId, channelAccountId]);
    return ap;
  }
  const status = async (id: string) => (await sql('select status, result from approvals where id = $1', [id])).rows[0] as { status: string; result: { reason?: string } | null };

  it('holds an email over the mailbox\'s daily cap, and lets the next day have it', async () => {
    const { id, channelAccountId } = await newCampaign({ channelAccountId: await newMailbox({ dailyCap: 2 }) });
    const t = new CountingTransport();
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await executeEmail(deps(t), await approved(id, channelAccountId)));
    expect(results.map((r) => r.status)).toEqual(['executed', 'executed', 'held']);
    expect(t.sent).toHaveLength(2);
    const held = results[2] as { reason: string; until: Date };
    expect(held.reason).toMatch(/hello-.*daily limit of 2/i);
    expect(held.until.getTime()).toBeGreaterThan(Date.now());
  });

  it('uses the smaller warm-up cap while the mailbox is warming up, and the full cap after', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const warm = await newMailbox({ dailyCap: 10, warmupUntil: tomorrow, warmupCap: 1 });
    const { id, channelAccountId } = await newCampaign({ channelAccountId: warm });
    const t = new CountingTransport();
    expect((await executeEmail(deps(t), await approved(id, channelAccountId))).status).toBe('executed');
    expect((await executeEmail(deps(t), await approved(id, channelAccountId))).status).toBe('held');
    await sql("update channel_accounts set warmup_until = current_date - 1 where id = $1", [warm]);
    expect((await executeEmail(deps(t), await approved(id, channelAccountId))).status).toBe('executed');
  });

  it('never lets parallel sends pass the mailbox cap', async () => {
    const { id, channelAccountId } = await newCampaign({ channelAccountId: await newMailbox({ dailyCap: 3 }) });
    const t = new CountingTransport();
    const ids = await Promise.all(Array.from({ length: 8 }, () => approved(id, channelAccountId)));
    const results = await Promise.all(ids.map((a) => executeEmail(deps(t), a)));
    expect(results.filter((r) => r.status === 'executed')).toHaveLength(3);
    expect(t.sent).toHaveLength(3);
  });

  it('keeps two mailboxes apart: one full mailbox does not hold the other', async () => {
    const a = await newCampaign({ channelAccountId: await newMailbox({ dailyCap: 1 }) });
    const b = await newCampaign({ channelAccountId: await newMailbox({ dailyCap: 1 }) });
    const t = new CountingTransport();
    expect((await executeEmail(deps(t), await approved(a.id, a.channelAccountId))).status).toBe('executed');
    expect((await executeEmail(deps(t), await approved(a.id, a.channelAccountId))).status).toBe('held');
    expect((await executeEmail(deps(t), await approved(b.id, b.channelAccountId))).status).toBe('executed');
  });

  it.each(['paused', 'approved', 'draft'] as const)('refuses, and says why, an email whose campaign is %s by the time it is sent', async (state) => {
    const { id, channelAccountId } = await newCampaign({}, 'running');
    const ap = await approved(id, channelAccountId);
    await sql('update campaigns set status = $2 where id = $1', [id, state]);
    const t = new CountingTransport();
    expect((await executeEmail(deps(t), ap)).status).toBe('refused');
    expect(t.sent).toHaveLength(0);
    expect((await status(ap)).result?.reason).toMatch(/campaign.*not running/i);
  });

  it('refuses an email from a mailbox that is paused or blocked', async () => {
    const { id, channelAccountId } = await newCampaign();
    const ap = await approved(id, channelAccountId);
    await sql("update channel_accounts set health = 'blocked' where id = $1", [channelAccountId]);
    const t = new CountingTransport();
    expect((await executeEmail(deps(t), ap)).status).toBe('refused');
    expect((await status(ap)).result?.reason).toMatch(/mailbox.*blocked/i);
    expect(t.sent).toHaveLength(0);
  });

  it('still sends an email with no campaign, as in slice 1', async () => {
    const t = new CountingTransport();
    expect((await executeEmail(deps(t), await approved(null, null))).status).toBe('executed');
  });
});
