import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutors } from '../src/actions';
import { outboxDmTransport, outboxPostTransport } from '../src/actions/post-transport';
import { OutboxTransport } from '../src/actions/transport';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore, osTools } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { DM_LIMITS, dmEligible, normalizeHandle } from '../src/dms';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let store: DbOsStore;
let companyRoot = '';
let agentId = '';
let runId = '';
let taskId = '';
const acc: Record<string, string> = {};
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId, taskId });
const tool = (name: string, args: unknown) => callOsTool(store, scope(), name, args).then((r) => ({ ok: true as const, text: r }), (e: Error) => ({ ok: false as const, text: e.message }));
const GAP = 1200; // long enough that a busy machine cannot let the second DM slip past the gap
const executors = () => createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot, from: 'a@b.test', postTransport: outboxPostTransport(sys.dataDir), dmTransport: outboxDmTransport(sys.dataDir), dmGapMs: GAP });
const dmFiles = () => (existsSync(path.join(sys.dataDir, 'outbox', 'dms')) ? readdirSync(path.join(sys.dataDir, 'outbox', 'dms')) : []);
let leadN = 0;
const newLead = async (stage = 'contacted', email: string | null = null) => (await sql("insert into leads (workspace_id, business_name, stage, email) values ($1, $2, $3, $4) returning id", [ws(), `Clinic ${++leadN}`, stage, email])).rows[0].id as string;
let lead = '';
const propose = (over: Record<string, unknown> = {}) => tool('propose_dm', { accountId: acc.x, leadId: lead, recipient: '@dana_clinic', text: 'Hi Dana, thanks for your reply to our email. Happy to share the concept here if that is easier.', ...over });
async function approvedDm(over: Record<string, unknown> = {}) {
  const r = await propose({ text: `Message number ${++leadN} for you.`, ...over });
  const id = /as ([0-9a-f-]{36})/.exec(r.text)?.[1];
  if (!id) throw new Error(`not queued: ${r.text}`);
  await sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);
  return id;
}
const dm = async (approvalId: string) => (await sql('select status, text, sent_at, error from dms where approval_id = $1', [approvalId])).rows[0];
const approval = async (id: string) => (await sql('select status, result from approvals where id = $1', [id])).rows[0];

const COMPANY = '# Acme\nBuilds start at $1,500.\n\n## Approved link domains\n- acme.test\n';

beforeAll(async () => {
  ({ sys } = await testSystem());
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-co-dm-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), COMPANY);
  store = new DbOsStore(sys.app, () => undefined, companyRoot);
  await agentNew(sys, { template: 'writer', department: 'marketing', id: 'dm-writer' });
  agentId = (await sql("select id from agents where key = 'dm-writer'")).rows[0].id;
  taskId = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 'dm', 'in_progress', $2, $2, 'founder') returning id", [ws(), agentId])).rows[0].id;
  runId = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId, taskId])).rows[0].id;
  for (const [k, channel, handle] of [['x', 'x_dm', '@acme_test'], ['ig', 'ig_dm', '@acme.test'], ['post', 'x', '@acme_posts'], ['mail', 'email', 'hi@acme.test']] as const) {
    acc[k] = (await sql('insert into channel_accounts (workspace_id, channel, handle, daily_cap, warmup_cap) values ($1, $2, $3, 10, 5) returning id', [ws(), channel, handle])).rows[0].id;
  }
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await rm(path.join(sys.dataDir, 'outbox', 'dms'), { recursive: true, force: true });
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  await sql("update channel_accounts set health = 'ok', daily_cap = 10, warmup_until = null");
  await sql('delete from dms');
  await sql('delete from action_items where approval_id is not null');
  await sql("delete from action_items where kind in ('executor_failed','send_unknown')");
  await sql("delete from approvals where kind = 'dm.send'");
  await sql('delete from suppression');
  lead = await newLead();
});

describe('the pure rules (S5-4)', () => {
  it('compares handles without @ or case', () => {
    expect(normalizeHandle(' @Dana_Clinic ')).toBe('dana_clinic');
  });
  it('lets a DM follow only contact a person already approved or received', () => {
    for (const s of ['contacted', 'replied', 'qualified', 'won']) expect(dmEligible(s), s).toBe(true);
    for (const s of ['new', 'lost', 'do_not_contact']) expect(dmEligible(s), s).toBe(false);
  });
  it('knows each platform\'s length', () => {
    expect(DM_LIMITS).toMatchObject({ x_dm: 10000, ig_dm: 1000 });
  });
});

describe('propose_dm (S5-4)', () => {
  it('needs autonomy 2', async () => {
    expect(osTools.propose_dm.minAutonomy).toBe(2);
    await sql('update agents set autonomy = 1 where id = $1', [agentId]);
    expect((await propose()).text).toMatch(/Unknown tool/);
  });

  it('queues one pending approval to one named person and sends nothing', async () => {
    const r = await propose();
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/Queued for approval.*Nothing has been sent/s);
    const ap = (await sql("select status, payload from approvals where kind = 'dm.send'")).rows[0];
    expect(ap).toMatchObject({ status: 'pending' });
    expect(ap.payload).toMatchObject({ channel: 'x_dm', handle: '@acme_test', recipient: '@dana_clinic', leadId: lead });
    expect(dmFiles()).toHaveLength(0);
    expect((await sql('select status, recipient from dms')).rows[0]).toMatchObject({ status: 'proposed', recipient: 'dana_clinic' });
  });

  it('is the same approval when the same words go to the same person on the same account', async () => {
    await propose();
    expect((await propose({ recipient: 'DANA_CLINIC' })).text).toMatch(/Already queued/);
    expect((await sql('select count(*)::int as n from dms')).rows[0].n).toBe(1);
    expect((await propose({ recipient: '@someone_else' })).text).toMatch(/Queued for approval/);
  });

  it('refuses a cold DM: the lead must have been written to (by an approved email) or have replied', async () => {
    const cold = await newLead('new');
    expect((await propose({ leadId: cold })).text).toMatch(/not been in touch|cold|contacted first/i);
    expect((await propose({ leadId: await newLead('replied') })).ok).toBe(true);
    expect((await propose({ leadId: await newLead('do_not_contact'), text: 'Hello again 2.' })).text).toMatch(/do not contact/i);
    expect((await propose({ leadId: '00000000-0000-4000-8000-000000000000' })).text).toMatch(/No such lead/);
  });

  it('refuses a person on the suppression list, by handle (with or without @) or through the lead\'s email', async () => {
    await sql("insert into suppression (workspace_id, value) values ($1, 'dana_clinic')", [ws()]);
    expect((await propose()).text).toMatch(/suppression list/);
    await sql('delete from suppression');
    await sql("insert into suppression (workspace_id, value) values ($1, '@dana_clinic')", [ws()]);
    expect((await propose({ text: 'Another try 3.' })).text).toMatch(/suppression list/);
    await sql('delete from suppression');
    const withMail = await newLead('contacted', 'dana@clinic.test');
    await sql("insert into suppression (workspace_id, value) values ($1, '@clinic.test')", [ws()]);
    expect((await propose({ leadId: withMail, text: 'Another try 4.' })).text).toMatch(/suppression list/);
  });

  it('refuses an account that is not a DM account, a paused one, and an unknown one', async () => {
    expect((await propose({ accountId: acc.post })).text).toMatch(/not a direct-message account/);
    expect((await propose({ accountId: acc.mail })).text).toMatch(/not a direct-message account/);
    expect((await propose({ accountId: '00000000-0000-4000-8000-000000000000' })).text).toMatch(/No such account/);
    await sql("update channel_accounts set health = 'paused' where id = $1", [acc.x]);
    expect((await propose()).text).toMatch(/paused/);
  });

  it('applies the same claims, link and length rules as a post', async () => {
    expect((await propose({ text: 'Our work will cure your slow site, guaranteed results.' })).text).toMatch(/medical claim/);
    expect((await propose({ text: 'Websites from $99 today.' })).text).toMatch(/price not in COMPANY\.md/);
    expect((await propose({ text: 'See https://evil.example/offer please.' })).text).toMatch(/evil\.example/);
    expect((await propose({ text: 'x'.repeat(DM_LIMITS.ig_dm + 1), accountId: acc.ig })).text).toMatch(/too long for ig_dm/);
    expect((await propose({ text: '   ' })).ok).toBe(false);
  });

  it('is for one person at a time: it takes no list, and nothing else can create a DM', async () => {
    expect((await propose({ recipient: ['@a', '@b'] })).ok).toBe(false);
    expect((await propose({ recipients: ['@a', '@b'] })).ok).toBe(false);
    expect((await tool('propose_dm', [{ accountId: acc.x }])).ok).toBe(false);
    expect(Object.keys(osTools).filter((n) => /dm/.test(n))).toEqual(['propose_dm']);
    expect(Object.keys(osTools).filter((n) => /bulk|follow|like|broadcast|mass/.test(n))).toEqual([]);
    const app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
    expect((await app.request('/api/dms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    expect((await sql('select count(*)::int as n from dms')).rows[0].n).toBe(0);
  });
});

describe('sending one DM at a time (S5-4)', () => {
  it('sends the approved DM once, to the named person, and records it', async () => {
    const id = await approvedDm();
    const ex = executors();
    expect(await ex.run(id)).toMatchObject({ status: 'executed' });
    expect(await ex.run(id)).toMatchObject({ status: 'already_claimed' });
    expect(dmFiles()).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(sys.dataDir, 'outbox', 'dms', dmFiles()[0]!), 'utf8'))).toMatchObject({ channel: 'x_dm', handle: '@acme_test', recipient: '@dana_clinic' });
    expect(await dm(id)).toMatchObject({ status: 'sent' });
    expect((await approval(id)).status).toBe('executed');
  });

  it('two DMs approved together go out one after the other, with the gap between them', async () => {
    const a = await approvedDm();
    const b = await approvedDm({ recipient: '@second_person' });
    const ex = executors();
    const [ra, rb] = (await Promise.all([ex.run(a), ex.run(b)])) as { status: string; until?: Date }[];
    const results = [ra!, rb!];
    expect(results.filter((r) => r.status === 'executed')).toHaveLength(1);
    const held = results.find((r) => r.status === 'held')!;
    expect(held.until!.getTime()).toBeGreaterThan(Date.now() - 50);
    expect(dmFiles()).toHaveLength(1);
    const second = results[0]!.status === 'held' ? a : b;
    expect((await approval(second)).status).toBe('approved'); // held, not failed
    await new Promise((r) => setTimeout(r, GAP + 100));
    expect(await ex.run(second)).toMatchObject({ status: 'executed' });
    expect(dmFiles()).toHaveLength(2);
    const sent = (await sql("select sent_at from dms where status = 'sent' order by sent_at")).rows;
    expect(sent[1].sent_at.getTime() - sent[0].sent_at.getTime()).toBeGreaterThanOrEqual(GAP - 50);
  });

  it('holds a DM over the account\'s daily limit until tomorrow, and uses the smaller warm-up limit while warming up', async () => {
    await sql('update channel_accounts set daily_cap = 1 where id = $1', [acc.x]);
    const a = await approvedDm();
    const ex = executors();
    expect(await ex.run(a)).toMatchObject({ status: 'executed' });
    await new Promise((r) => setTimeout(r, GAP + 100));
    const b = await approvedDm({ recipient: '@another' });
    const r = (await ex.run(b)) as { status: string; until: Date; reason: string };
    expect(r.status).toBe('held');
    expect(r.reason).toMatch(/daily limit of 1/);
    expect(r.until.getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect(dmFiles()).toHaveLength(1);

    await sql('delete from dms');
    await sql("update channel_accounts set daily_cap = 10, warmup_cap = 1, warmup_until = (current_date + 3) where id = $1", [acc.x]);
    const c = await approvedDm({ recipient: '@c1' });
    expect(await ex.run(c)).toMatchObject({ status: 'executed' });
    await new Promise((r2) => setTimeout(r2, GAP + 100));
    expect(await ex.run(await approvedDm({ recipient: '@c2' }))).toMatchObject({ status: 'held', reason: expect.stringMatching(/warming up/) });
  });

  it('does nothing while the kill switch is on', async () => {
    const id = await approvedDm();
    await sql('update workspace_settings set kill_switch = 1 where workspace_id = $1', [ws()]);
    expect(await executors().run(id)).toMatchObject({ status: 'kill_switch' });
    expect(dmFiles()).toHaveLength(0);
    expect((await approval(id)).status).toBe('approved');
  });

  it('checks again at send time: a lead marked do not contact, a suppressed person or a paused account sends nothing', async () => {
    const ex = executors();
    const a = await approvedDm();
    await sql("update leads set stage = 'do_not_contact' where id = $1", [lead]);
    expect(await ex.run(a)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/do not contact/) });
    await sql("update leads set stage = 'contacted' where id = $1", [lead]);
    const b = await approvedDm({ recipient: '@gone_quiet' });
    await sql("insert into suppression (workspace_id, value) values ($1, 'gone_quiet')", [ws()]);
    expect(await ex.run(b)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/suppression/) });
    await sql('delete from suppression');
    const c = await approvedDm({ recipient: '@third' });
    await sql("update channel_accounts set health = 'blocked' where id = $1", [acc.x]);
    expect(await ex.run(c)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/blocked/) });
    expect(dmFiles()).toHaveLength(0);
    expect((await dm(a)).status).toBe('failed');
  });

  it('never sends what is pending, rejected or expired, and does not resend one left mid-send', async () => {
    const ex = executors();
    for (const status of ['pending', 'rejected', 'expired']) {
      const id = await approvedDm({ recipient: `@p_${status}` });
      await sql('update approvals set status = $2 where id = $1', [id, status]);
      expect(await ex.run(id)).toMatchObject({ status: 'already_claimed' });
    }
    const mid = await approvedDm({ recipient: '@mid' });
    await sql("update approvals set status = 'executing' where id = $1", [mid]);
    await sql("update dms set status = 'sending' where approval_id = $1", [mid]);
    const rec = await ex.recover();
    expect(rec.unknown).toContain(mid);
    expect((await dm(mid)).status).toBe('failed');
    expect(dmFiles()).toHaveLength(0);
  });
});
