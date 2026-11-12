import { mkdtemp, cp, writeFile } from 'node:fs/promises';
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
const call = (method: string, path: string, body?: unknown) => app.request(`/api${path}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
const ok = async <T>(res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};

beforeAll(async () => {
  ({ sys } = await testSystem());
  await syncCompany(sys.app, ws(), await loadCompany(sys.companyRoot));
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from deal_stage_events');
  await sql('delete from projects');
  await sql("delete from tasks where created_by = 'system'");
  await sql('delete from deals');
  await sql('delete from contacts');
  await sql('update leads set account_id = null');
  await sql('delete from accounts');
});

type Funnel = { key: string; name: string; stages: { key: string; name: string; position: number; owner: string | null; exit_rule: string | null; exit_requires: string[] }[] };
const newDeal = async (funnel?: string) => {
  const { id: accountId } = await ok<{ id: string }>(await call('POST', '/accounts', { name: 'Glow Clinic' }), 201);
  const { id } = await ok<{ id: string }>(await call('POST', '/deals', { accountId, offer: 'Homepage', value: 2500, ...(funnel ? { funnel } : {}) }), 201);
  return { id, accountId };
};
const deal = async (id: string) => ok<{ stage: string; status: string; funnel: string; decision_maker: string | null; due: string | null }>(await call('GET', `/deals/${id}`));
const move = (id: string, stage: string) => call('POST', `/deals/${id}/stage`, { stage });

describe('funnels come from company/funnels.yaml (S2-2)', () => {
  it('loads both funnels, in order, with owners and exit rules', async () => {
    const funnels = await ok<Funnel[]>(await call('GET', '/funnels'));
    expect(funnels.map((f) => f.key).sort()).toEqual(['product', 'services']);
    const services = funnels.find((f) => f.key === 'services')!;
    expect(services.stages).toHaveLength(9);
    expect(services.stages.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(services.stages[0]).toMatchObject({ key: 'target', owner: 'lead-gen' });
    expect(services.stages[5]!.exit_requires.sort()).toEqual(['decision_maker', 'due']);
    expect(funnels.find((f) => f.key === 'product')!.stages).toHaveLength(8);
  });

  it('is a copy of the file: editing the file and syncing changes the rows, without losing deals', async () => {
    const { id } = await newDeal('services');
    const root = await mkdtemp(path.join(tmpdir(), 'conclave-fun-'));
    await cp(sys.companyRoot, root, { recursive: true });
    const yaml = (await import('node:fs')).readFileSync(path.join(root, 'funnels.yaml'), 'utf8').replace('name: Target', 'name: Right fit');
    await writeFile(path.join(root, 'funnels.yaml'), yaml);
    await syncCompany(sys.app, ws(), await loadCompany(root));
    const services = (await ok<Funnel[]>(await call('GET', '/funnels'))).find((f) => f.key === 'services')!;
    expect(services.stages[0]!.name).toBe('Right fit');
    expect((await deal(id)).stage).toBe('target'); // the deal kept its stage
    await syncCompany(sys.app, ws(), await loadCompany(sys.companyRoot)); // put it back
  });

  it('refuses a bad funnels file with the file and the reason', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'conclave-fun-'));
    await cp(sys.companyRoot, root, { recursive: true });
    const yaml = (await import('node:fs')).readFileSync(path.join(root, 'funnels.yaml'), 'utf8');
    await writeFile(path.join(root, 'funnels.yaml'), yaml.replace('requires: [decision_maker, due]', 'requires: [favourite_colour]'));
    await expect(loadCompany(root)).rejects.toThrow(CompanyLoadError);
    await expect(loadCompany(root)).rejects.toThrow(/funnels\.yaml.*favourite_colour/);
  });
});

describe('moving a deal (S2-2)', () => {
  it('starts a new deal at the first stage of its funnel', async () => {
    const { id } = await newDeal('services');
    expect(await deal(id)).toMatchObject({ stage: 'target', status: 'open', funnel: 'services' });
    const p = await newDeal('product');
    expect(await deal(p.id)).toMatchObject({ stage: 'target', funnel: 'product' });
  });

  it('moves it forward and back, logging every move with who and when', async () => {
    const { id } = await newDeal('services');
    expect((await move(id, 'signal')).status).toBe(200);
    expect((await move(id, 'first-touch')).status).toBe(200);
    expect((await move(id, 'signal')).status).toBe(200); // back is allowed
    const events = (await sql('select from_stage, to_stage, actor from deal_stage_events where deal_id = $1 order by id', [id])).rows;
    expect(events).toEqual([
      { from_stage: 'target', to_stage: 'signal', actor: 'founder' },
      { from_stage: 'signal', to_stage: 'first-touch', actor: 'founder' },
      { from_stage: 'first-touch', to_stage: 'signal', actor: 'founder' },
    ]);
    expect((await sql("select 1 from audit_log where action = 'deal.stage_changed' and subject = $1", [id])).rowCount).toBe(3);
  });

  it('refuses an unknown stage, the stage it is already in, and another funnel\'s stage', async () => {
    const { id } = await newDeal('services');
    expect((await move(id, 'nonsense')).status).toBe(400);
    expect((await move(id, 'target')).status).toBe(409);
    expect((await move(id, 'slice-session')).status).toBe(400); // a product stage
    expect((await call('POST', `/deals/${id}/stage`, {})).status).toBe(400);
    expect((await call('POST', '/deals/00000000-0000-4000-8000-000000000000/stage', { stage: 'signal' })).status).toBe(404);
  });

  it('will not pass the first priced outcome without a named decision-maker and a date', async () => {
    const { id } = await newDeal('services');
    expect((await move(id, 'first-priced-outcome')).status).toBe(200); // arriving is fine
    const refused = await move(id, 'deliver');
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/decision-maker.*date|decision_maker.*due/i);
    await ok(await call('PATCH', `/deals/${id}`, { decisionMaker: 'Dana Whitfield' }));
    const half = await move(id, 'deliver');
    expect(half.status).toBe(409); // still no date
    expect(((await half.json()) as { error: string }).error).toMatch(/date|due/i);
    await ok(await call('PATCH', `/deals/${id}`, { due: '2026-12-15' }));
    expect((await move(id, 'deliver')).status).toBe(200);
  });

  it('applies the same rule when stages are skipped', async () => {
    const { id } = await newDeal('services');
    expect((await move(id, 'deliver')).status).toBe(409); // from target straight past stage 6
    expect((await move(id, 'free-concept')).status).toBe(200); // skipping ahead short of the gate is allowed
  });

  it('treats a blank decision-maker as not named', async () => {
    const { id } = await newDeal('services');
    await move(id, 'first-priced-outcome');
    expect((await call('PATCH', `/deals/${id}`, { decisionMaker: '   ' })).status).toBe(400);
  });
});

describe('winning a deal (S2-2)', () => {
  const win = async () => {
    const { id, accountId } = await newDeal('services');
    await move(id, 'first-priced-outcome');
    await call('PATCH', `/deals/${id}`, { decisionMaker: 'Dana', due: '2026-12-15' });
    expect((await move(id, 'deliver')).status).toBe(200);
    return { id, accountId };
  };

  it('creates the client project and its first tasks, once', async () => {
    const { id, accountId } = await win();
    expect(await deal(id)).toMatchObject({ status: 'won', stage: 'deliver' });
    const projects = (await sql('select id, account_id, name, status from projects where deal_id = $1', [id])).rows;
    expect(projects).toEqual([expect.objectContaining({ account_id: accountId, status: 'active' })]);
    expect(projects[0].name).toContain('Glow Clinic');
    const tasks = (await sql("select title, created_by from tasks where subject_type = 'project' and subject_id = $1 order by created_at, title", [projects[0].id])).rows;
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks.every((t) => t.created_by === 'system')).toBe(true);
    expect((await sql("select stage from accounts where id = $1", [accountId])).rows[0].stage).toBe('client');
  });

  it('does not create a second project when the deal moves on, back and forward again', async () => {
    const { id } = await win();
    await move(id, 'outcome-note');
    await move(id, 'deliver');
    await move(id, 'retainer');
    expect((await sql('select count(*)::int as n from projects where deal_id = $1', [id])).rows[0].n).toBe(1);
    expect((await sql("select count(*)::int as n from tasks where subject_type = 'project'")).rows[0].n).toBe(2);
  });

  it('wins the product funnel at the paid pilot', async () => {
    const { id } = await newDeal('product');
    expect((await move(id, 'paid-pilot')).status).toBe(200);
    expect((await deal(id)).status).toBe('won');
    expect((await sql('select count(*)::int as n from projects where deal_id = $1', [id])).rows[0].n).toBe(1);
  });

  it('can be marked lost, with a reason, and then is not moved', async () => {
    const { id } = await newDeal('services');
    expect((await call('POST', `/deals/${id}/lose`, {})).status).toBe(400);
    expect((await call('POST', `/deals/${id}/lose`, { reason: 'Chose someone cheaper.' })).status).toBe(200);
    expect((await deal(id)).status).toBe('lost');
    expect((await move(id, 'signal')).status).toBe(409);
    expect((await call('POST', `/deals/${id}/lose`, { reason: 'again' })).status).toBe(409);
  });
});

describe('which funnel a deal starts in (S2-2)', () => {
  it('follows the account\'s market when none is named', async () => {
    const { id: accountId } = await ok<{ id: string }>(await call('POST', '/accounts', { name: 'Vespera Spa', market: 'product' }), 201);
    const { id } = await ok<{ id: string }>(await call('POST', '/deals', { accountId, offer: 'Pilot' }), 201);
    expect(await deal(id)).toMatchObject({ funnel: 'product', stage: 'target' });
  });

  it('refuses a funnel that does not exist', async () => {
    const { id: accountId } = await ok<{ id: string }>(await call('POST', '/accounts', { name: 'X' }), 201);
    expect((await call('POST', '/deals', { accountId, funnel: 'nope' })).status).toBe(400);
  });

  it('puts a promoted lead\'s deal in the funnel for the lead\'s market', async () => {
    const lead = await ok<{ id: string }>(await call('POST', '/leads', { businessName: 'Spa Seven', email: 'spa7@x.test', market: 'product' }), 201);
    const r = await ok<{ dealId: string }>(await call('POST', `/leads/${lead.id}/promote`, {}), 201);
    expect(await deal(r.dealId)).toMatchObject({ funnel: 'product', stage: 'target' });
  });
});
