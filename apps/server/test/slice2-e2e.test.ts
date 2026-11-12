import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { loadCompany } from '../src/company/loader';
import { syncCompany } from '../src/company/sync';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { executeRun, type LoopDeps } from '../src/harness/loop';
import { MemoryOsStore, type OsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { approvalHooks, createOutreach } from '../src/outreach';
import { mcpRoutes } from '../src/routes/mcp';
import { createCliRuntime } from '../src/runtimes/cli';
import type { System } from '../src/system';
import { LocalApprovalGate } from '../src/workflows/approval-gate';
import { LocalDispatcher, tick } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/**
 * Slice 2 end to end (S2-13, SPEC 18 row 2). One run, on the outbox, with the real run loop, os server, API, gate,
 * executor, sequence runner, ticker and report queries. Only the model is a stand-in (a fake claude process that plays the
 * prospector and the outreach rep). Done when: (1) new scored leads arrive every morning; (2) a reply pauses its sequence;
 * (3) the pipeline shows conversion by stage.
 */
const fake = path.join(__dirname, 'fixtures', 'fake-cli.mjs');
const FOOTER = 'Test Co, 12 Main Street, Lahore 54000, Pakistan';
const json = { 'content-type': 'application/json', origin: 'http://localhost:3000' };
const UTC = { tz: 'UTC' };

let sys: System;
let osServer: ReturnType<typeof serve>;
let dataDir: string;
let app: ReturnType<typeof createApp>;
let gate: LocalApprovalGate;
let dispatcher: LocalDispatcher;
const tokens = new RunTokens();
const bus = new Bus();
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const call = (method: string, p: string, body?: unknown) => app.request(`/api${p}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
const ok = async <T>(res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};
const outbox = () => readdir(path.join(dataDir, 'outbox')).catch(() => [] as string[]);

const deps = (mode: 'prospect' | 'propose'): LoopDeps => ({
  pool: sys.app,
  tokens,
  bus,
  runtimes: {
    'claude-cli': createCliRuntime('claude-cli', { command: { command: process.execPath, prefixArgs: [fake, 'claude', mode] } }),
    opencode: createCliRuntime('opencode', { command: { command: process.execPath, prefixArgs: [fake, 'opencode', mode] } }),
  },
  dataDir: sys.dataDir,
  workspaceSlug: sys.workspace.slug,
  templatesRoot: sys.templatesRoot,
  timeoutMs: 30_000,
});

beforeAll(async () => {
  const real: { store?: OsStore } = {};
  const store = new Proxy({} as OsStore, {
    get: (_t, prop: string) => (...args: unknown[]) => (real.store as unknown as Record<string, (...a: unknown[]) => unknown>)[prop]!(...args),
  });
  await new Promise<void>((r) => {
    osServer = serve({ fetch: new Hono().route('/mcp', mcpRoutes({ tokens, store })).fetch, port: 0, hostname: '127.0.0.1' }, () => r());
  });
  sys = (await testSystem(`http://127.0.0.1:${(osServer.address() as AddressInfo).port}/mcp`)).sys;
  await syncCompany(sys.app, ws(), await loadCompany(sys.companyRoot));
  const companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-s2-co-'));
  dataDir = await mkdtemp(path.join(tmpdir(), 'conclave-s2-data-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), `# Test Co\n\n## Cold email footer\n${FOOTER}\n`);

  const outreach = createOutreach({ pool: sys.app, workspaceId: ws(), dataDir, companyRoot, bus, env: { OUTREACH_FROM: 'Anees <hello@example.test>' } });
  gate = new LocalApprovalGate({ pool: sys.app, workspaceId: ws(), executors: outreach.executors, bus });
  const hooks = approvalHooks(gate);
  real.store = new DbOsStore(sys.app, undefined, companyRoot, hooks.onApprovalRequested);
  // The dispatcher starts whichever agent is asked for: the prospector scripted as a prospector, the rep as a rep.
  dispatcher = new LocalDispatcher(async (e) => {
    const key = (await sql('select key from agents where id = $1', [e.agentId])).rows[0].key as string;
    return executeRun(deps(key === 'prospector' ? 'prospect' : 'propose'), ws(), e.agentId, e.trigger);
  });
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens, store: new MemoryOsStore(), bus, dispatcher, onApprovalDecided: hooks.onApprovalDecided, onReleaseHeld: hooks.onReleaseHeld });

  await agentNew(sys, { template: 'prospector', department: 'lead-gen', id: 'prospector' });
  await agentNew(sys, { template: 'outreach-rep', department: 'outreach', id: 'rep', autonomy: 2 });
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0, email_daily_cap = 100000, window_hours = 5, window_cap = 100000', [ws()]);
}, 300_000);
afterAll(async () => {
  gate?.stop();
  osServer?.close();
  await sys?.close();
});

const state: { campaign: string; qualified: string[]; replied: string; other: string } = { campaign: '', qualified: [], replied: '', other: '' };

describe('slice 2 end to end', () => {
  it('(1) a morning heartbeat adds scored leads, once, with their sources', async () => {
    // Nothing yet at 06:59; at 07:00 the prospector is asked, given its standing task, and runs.
    expect(await tick(sys.app, ws(), dispatcher, new Date('2026-11-13T06:59:00Z'), new Map(), UTC)).toEqual([]);
    const woken = await tick(sys.app, ws(), dispatcher, new Date('2026-11-13T07:00:30Z'), new Map(), UTC);
    expect(woken).toHaveLength(1);
    await dispatcher.idle();
    // Every later minute that morning, even from a restarted ticker: no second run.
    await tick(sys.app, ws(), dispatcher, new Date('2026-11-13T07:05:00Z'), new Map(), UTC);
    await dispatcher.idle();
    expect((await sql("select count(*)::int as n from tasks where kind = 'heartbeat'")).rows[0].n).toBe(1);

    const leads = (await sql('select id, business_name, score, verified, source_url from leads order by score desc')).rows;
    expect(leads.map((l) => [l.business_name, l.score, l.verified])).toEqual([['Alpha Clinic', 90, true], ['Beta Spa', 75, true], ['Gamma Salon', 55, true]]);
    expect(leads.every((l) => /^https:\/\/maps\.example\.test\//.test(l.source_url))).toBe(true);
    state.qualified = leads.filter((l) => l.score >= 70).map((l) => l.id as string);
    expect(state.qualified).toHaveLength(2);
  }, 120_000);

  it('(1b) the founder approves a campaign, its due steps become tasks, drafts are approved and reach the outbox', async () => {
    const mb = (await ok<{ id: string }>(await call('POST', '/channel-accounts', { channel: 'email', handle: 'hello@example.test', dailyCap: 10 }), 201)).id;
    state.campaign = (await ok<{ id: string }>(await call('POST', '/campaigns', { name: 'Clinics Lahore', market: 'services', channel: 'email', channelAccountId: mb }), 201)).id;
    await ok(await call('PUT', `/campaigns/${state.campaign}/steps`, { steps: [{ step: 1, waitDays: 0, skill: 'first-touch-email' }, { step: 2, waitDays: 3, skill: 'follow-up' }] }));
    expect((await call('POST', `/campaigns/${state.campaign}/start`, {})).status).toBe(409); // not before the founder approves
    await ok(await call('POST', `/campaigns/${state.campaign}/approve`, {}));
    await ok(await call('POST', `/campaigns/${state.campaign}/start`, {}));
    expect((await ok<{ enrolled: number }>(await call('POST', `/campaigns/${state.campaign}/enroll`, { leadIds: state.qualified }))).enrolled).toBe(2);

    expect(await ok<{ created: number }>(await call('POST', '/run-sequences', {}))).toMatchObject({ created: 2 });
    expect(await ok<{ created: number }>(await call('POST', '/run-sequences', {}))).toMatchObject({ created: 0 }); // no duplicates
    for (let i = 0; i < 2; i++) await dispatcher.request({ workspaceId: ws(), agentId: (await sql("select id from agents where key = 'rep'")).rows[0].id, trigger: 'task_assigned' }).then(() => dispatcher.idle());
    const pending = await ok<{ id: string }[]>(await call('GET', '/approvals?status=pending'));
    expect(pending).toHaveLength(2);
    expect(await outbox()).toEqual([]); // proposed, not sent

    for (const a of pending) expect((await call('POST', `/approvals/${a.id}/decide`, { approved: true })).status).toBe(200);
    for (let i = 0; i < 100 && (await outbox()).length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await outbox()).toHaveLength(2);
    expect((await sql("select count(*)::int as n from sequence_enrollments where steps_sent = 1")).rows[0].n).toBe(2);
    [state.replied, state.other] = state.qualified as [string, string];
  }, 180_000);

  it('(2) a reply pauses its sequence and makes exactly one triage task; others keep going', async () => {
    const r = await ok<{ taskId: string | null; paused: number }>(await call('POST', `/leads/${state.replied}/inbound`, { subject: 'Re: concept', body: 'Interested! Can we talk Tuesday?' }), 201);
    expect(r.paused).toBe(1);
    await call('POST', `/leads/${state.replied}/inbound`, { body: 'Also, Tuesday morning works.' });
    expect((await sql("select count(*)::int as n from tasks where kind = 'triage'")).rows[0].n).toBe(1);
    const mine = (await sql('select status from sequence_enrollments where lead_id = $1', [state.replied])).rows[0];
    expect(mine.status).toBe('paused');

    // Three days later the other lead is due for step 2; the one who replied gets nothing.
    await sql("update sequence_enrollments set last_sent_at = now() - interval '3 days 1 hour'");
    expect(await ok<{ created: number }>(await call('POST', '/run-sequences', {}))).toMatchObject({ created: 1 });
    const step2 = (await sql("select body from tasks where kind = 'sequence_step' and title like 'Step 2%'")).rows;
    expect(step2).toHaveLength(1);
    expect(step2[0].body).toContain(state.other);
    expect(step2[0].body).not.toContain(state.replied);

    const msg = (await sql("select m.id from thread_messages m join threads t on t.id = m.thread_id where t.lead_id = $1 and m.direction = 'in' order by m.at limit 1", [state.replied])).rows[0].id;
    await ok(await call('POST', `/thread-messages/${msg}/classify`, { classification: 'positive' }));
  }, 120_000);

  it('(3) the pipeline shows conversion by stage, and the campaign shows its results', async () => {
    const promote = async (lead: string) => ok<{ dealId: string }>(await call('POST', `/leads/${lead}/promote`, {}), 201);
    const a = await promote(state.replied);
    await promote(state.other);
    await ok(await call('POST', `/deals/${a.dealId}/stage`, { stage: 'signal' }));
    await ok(await call('POST', `/deals/${a.dealId}/stage`, { stage: 'first-touch' }));
    await ok(await call('POST', `/deals/${a.dealId}/stage`, { stage: 'reply' }));

    const p = await ok<{ stages: { key: string; current: number; reached: number; conversion: number | null }[]; totals: { open: number } }>(await call('GET', '/pipeline?funnel=services'));
    const st = (k: string) => p.stages.find((s) => s.key === k)!;
    expect(st('target')).toMatchObject({ current: 1, reached: 2 }); // the other lead is still at the start
    expect(st('reply')).toMatchObject({ current: 1, reached: 1 });
    expect(st('target').conversion).toBeCloseTo(0.5, 5); // one of two got past it
    expect(st('signal').conversion).toBeCloseTo(1, 5); // and the one that did kept going
    expect(p.totals.open).toBe(2);

    const r = await ok<{ enrolled: number; sent: number; replied: number; positive_replies: number; reply_rate: number; enrollment: { paused: number; active: number } }>(await call('GET', `/campaigns/${state.campaign}/results`));
    expect(r).toMatchObject({ enrolled: 2, sent: 2, replied: 1, positive_replies: 1 });
    expect(r.reply_rate).toBeCloseTo(0.5, 5);
    expect(r.enrollment).toMatchObject({ paused: 1, active: 1 });
  }, 120_000);

  it('(extra) the morning brief and the goals read the same facts', async () => {
    const b = await ok<{ content: { leads: { new: number; qualified: number }; replies: { to_triage: number }; goals: { departments: { department: string; current: number }[] } } }>(await call('POST', '/brief/rebuild', {}), 201);
    expect(b.content.leads).toMatchObject({ new: 3, qualified: 2 });
    expect(b.content.replies.to_triage).toBe(1);
    const g = await ok<{ departments: { department: string; current: number }[] }>(await call('GET', '/goals'));
    expect(g.departments.find((d) => d.department === 'lead-gen')!.current).toBe(2); // the same two qualified leads
    expect(b.content.goals.departments.find((d) => d.department === 'lead-gen')!.current).toBe(2);
    expect(g.departments.find((d) => d.department === 'outreach')!.current).toBe(1); // one person replied positively
  }, 60_000);
});
