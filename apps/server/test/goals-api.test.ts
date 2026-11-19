import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { CompanyLoadError, loadCompany } from '../src/company/loader';
import { syncCompany } from '../src/company/sync';
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
const call = (method: string, p: string, body?: unknown) => app.request(`/api${p}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
const ok = async <T>(res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};

interface Rung { key: string; title: string; target: number; due: string | null; status: string; current: number; pct: number; met: boolean }
interface Dept { key: string; department: string; metric: string; target: number | null; current: number | null; pct: number | null; measured: boolean; window: string | null; serves: string | null }
interface Goals { current_rung: string | null; rungs: Rung[]; departments: Dept[] }
const goals = async () => ok<Goals>(await call('GET', '/goals'));
const dept = (g: Goals, name: string) => g.departments.find((d) => d.department === name)!;

beforeAll(async () => {
  ({ sys } = await testSystem());
  await syncCompany(sys.app, ws(), await loadCompany(sys.companyRoot));
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from thread_messages');
  await sql('delete from threads');
  await sql('delete from deal_stage_events');
  await sql('delete from projects');
  await sql("delete from tasks where created_by = 'system'");
  await sql('delete from deals');
  await sql('delete from contacts');
  await sql('update leads set account_id = null');
  await sql('delete from accounts');
  await sql('delete from leads');
});

const lead = async (over: { score?: number | null; verified?: boolean; ageDays?: number } = {}) =>
  (
    await sql("insert into leads (workspace_id, business_name, email, score, verified, created_at) values ($1, 'L', $2, $3, $4, now() - make_interval(days => $5)) returning id", [
      ws(),
      `l-${randomUUID().slice(0, 8)}@x.test`,
      over.score === undefined ? 80 : over.score,
      over.verified ?? true,
      over.ageDays ?? 0,
    ])
  ).rows[0].id as string;
async function wonDeal(value: number) {
  const { id: accountId } = await ok<{ id: string }>(await call('POST', '/accounts', { name: `Acct ${randomUUID().slice(0, 4)}` }), 201);
  const { id } = await ok<{ id: string }>(await call('POST', '/deals', { accountId, funnel: 'services', offer: 'Build', value, decisionMaker: 'Dana', due: '2026-12-01' }), 201);
  await ok(await call('POST', `/deals/${id}/stage`, { stage: 'deliver' }));
  return id;
}

describe('goals from company/goals.yaml (S2-9)', () => {
  it('lists the ladder and the department goals the file names, with targets', async () => {
    const g = await goals();
    expect(g.rungs.map((r) => r.key)).toEqual(['rung-1', 'rung-2', 'rung-3']);
    expect(g.current_rung).toBe('rung-1');
    expect(g.rungs[0]).toMatchObject({ target: 1000, status: 'active', current: 0, pct: 0, met: false });
    expect(g.departments.map((d) => d.department).sort()).toEqual(['engineering', 'lead-gen', 'outreach', 'product']);
    expect(dept(g, 'lead-gen')).toMatchObject({ metric: 'qualified_leads_per_week', target: 20, serves: 'rung-1', measured: true });
  });

  it('refuses a goals file whose stage does not exist, naming the file and the stage', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'conclave-goals-'));
    await cp(sys.companyRoot, root, { recursive: true });
    const yaml = (await readFile(path.join(root, 'goals.yaml'), 'utf8')).replace('services/free-concept', 'services/no-such-stage');
    await writeFile(path.join(root, 'goals.yaml'), yaml);
    await expect(loadCompany(root)).rejects.toThrow(CompanyLoadError);
    await expect(loadCompany(root)).rejects.toThrow(/goals\.yaml.*no-such-stage/);
  });
});

describe('progress is read from the tables, never typed (S2-9)', () => {
  it('counts qualified leads this week: verified, scored 70 or more, added in the last 7 days', async () => {
    await lead({ score: 90 });
    await lead({ score: 70 });
    await lead({ score: 69 }); // below the line
    await lead({ score: null }); // not scored
    await lead({ score: 95, verified: false }); // no source
    await lead({ score: 95, ageDays: 10 }); // too old for this week
    const g = await goals();
    expect(dept(g, 'lead-gen')).toMatchObject({ current: 2, target: 20, pct: 10, window: '7 days' });
    await lead({ score: 88 });
    expect(dept(await goals(), 'lead-gen').current).toBe(3); // it moves when the tables do
  });

  it('counts people who replied positively this week, once each', async () => {
    const a = await lead();
    const b = await lead();
    const c = await lead();
    const say = async (leadId: string, body: string, cls: string | null, ageDays = 0) => {
      const t = (await sql('insert into threads (workspace_id, lead_id) values ($1, $2) on conflict (workspace_id, lead_id) where lead_id is not null do update set status = threads.status returning id', [ws(), leadId])).rows[0].id;
      await sql("insert into thread_messages (workspace_id, thread_id, direction, body, classification, at) values ($1, $2, 'in', $3, $4, now() - make_interval(days => $5))", [ws(), t, body, cls, ageDays]);
    };
    await say(a, 'Yes!', 'positive');
    await say(a, 'And Tuesday works', 'positive'); // same person: one
    await say(b, 'Not now', 'negative');
    await say(c, 'Interested', 'positive', 9); // last week's
    expect(dept(await goals(), 'outreach')).toMatchObject({ metric: 'positive_replies_per_week', current: 1, target: 3 });
  });

  it('counts how many deals left a funnel stage this week, as the file says which', async () => {
    const mk = async (stage: string) => {
      const { id: accountId } = await ok<{ id: string }>(await call('POST', '/accounts', { name: `A${randomUUID().slice(0, 4)}` }), 201);
      const { id } = await ok<{ id: string }>(await call('POST', '/deals', { accountId, funnel: 'services' }), 201);
      await ok(await call('POST', `/deals/${id}/stage`, { stage: 'free-concept' }));
      if (stage !== 'free-concept') await ok(await call('POST', `/deals/${id}/stage`, { stage }));
      return id;
    };
    const left = await mk('first-priced-outcome'); // left free-concept
    await mk('free-concept'); // still in it
    const old = await mk('first-priced-outcome');
    await sql("update deal_stage_events set at = now() - interval '9 days' where deal_id = $1 and from_stage = 'free-concept'", [old]);
    expect(dept(await goals(), 'engineering')).toMatchObject({ metric: 'stage_exits_per_week', current: 1, target: 2, measured: true });
    void left;
  });

  it('adds up what the deals won this month are worth, and not other months or lost deals', async () => {
    await wonDeal(600);
    await wonDeal(250);
    const last = await wonDeal(5000);
    await sql("update projects set created_at = now() - interval '45 days' where deal_id = $1", [last]); // won in an earlier month
    const g = await goals();
    expect(g.rungs[0]).toMatchObject({ current: 850, pct: 85, met: false });
    await wonDeal(300);
    const after = await goals();
    expect(after.rungs[0]).toMatchObject({ current: 1150, met: true });
    expect(after.rungs[0]!.pct).toBe(115); // over 100 is allowed to show
    expect(after.rungs[1]).toMatchObject({ current: 1150, pct: 28.75 }); // the same revenue against the next rung's target
  });

  it('says "not measured" for a metric nothing can compute, instead of showing zero', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'conclave-goals-'));
    await cp(sys.companyRoot, root, { recursive: true });
    const yaml = (await readFile(path.join(root, 'goals.yaml'), 'utf8')).replace('metric: qualified_leads_per_week', 'metric: vibes_per_week');
    await writeFile(path.join(root, 'goals.yaml'), yaml);
    await syncCompany(sys.app, ws(), await loadCompany(root));
    const d = dept(await goals(), 'lead-gen');
    expect(d).toMatchObject({ metric: 'vibes_per_week', measured: false, current: null, pct: null });
    await syncCompany(sys.app, ws(), await loadCompany(sys.companyRoot));
  });

  it('is read-only here: the company file is where goals change', async () => {
    expect((await call('PATCH', '/goals/rung-1', { target: 5 })).status).toBe(404);
    expect((await call('POST', '/goals', { title: 'x' })).status).toBe(404);
  });
});
