import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { parseRoleFile, loadCompany } from '../src/company/loader';
import { syncCompany } from '../src/company/sync';
import { withWorkspace } from '../src/db/tenant';
import { checkFigures, extractFigures } from '../src/documents/figures';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore, osTools } from '../src/harness/os-tools';
import { loadPlugin } from '../src/harness/plugins';
import { loadTemplate, renderRoleFile, renderWorkdir } from '../src/harness/render';
import { RunTokens } from '../src/harness/run-tokens';
import { REPO_ROOT } from '../src/paths';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

describe('figures in a draft (S2-12)', () => {
  it('finds money, percentages, decimals and bigger numbers, and leaves small list numbers alone', () => {
    expect(extractFigures('Build for $2,500 in 3 steps, up from 12 steps, a 25% drop, then 4.5 days. Step 2 of 3. 1) one')).toEqual([2500, 12, 25, 4.5]);
    expect(extractFigures('Nothing numeric here, only ten words.')).toEqual([]);
    expect(extractFigures('Year 2026 and 1,000,000 views')).toEqual([2026, 1000000]);
  });

  it('accepts only figures that are in the allowed set, and names the ones that are not', () => {
    const allowed = new Set([2500, 12, 4]);
    expect(checkFigures('The build is $2,500 and takes 4 days.', allowed)).toEqual({ ok: true, unknown: [] });
    expect(checkFigures('We cut steps from 12 to 3, a 40% gain, for $2,500.', allowed)).toEqual({ ok: false, unknown: ['40'] });
    expect(checkFigures('We raised conversion by 300%.', allowed).unknown).toEqual(['300']);
  });
});

let sys: System;
let app: ReturnType<typeof createApp>;
let store: DbOsStore;
let agentId = '';
let taskId = '';
let runId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const call = (method: string, p: string, body?: unknown) => app.request(`/api${p}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
const ok = async <T>(res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};
const tool = (name: string, args: unknown) =>
  callOsTool(store, { workspaceId: ws(), agentId, runId, taskId }, name, args).then((r) => ({ ok: true as const, text: r }), (e: Error) => ({ ok: false as const, text: e.message }));

let dealId = '';
beforeAll(async () => {
  ({ sys } = await testSystem());
  await syncCompany(sys.app, ws(), await loadCompany(sys.companyRoot));
  store = new DbOsStore(sys.app);
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
  await agentNew(sys, { template: 'deal-desk', department: 'outreach', id: 'desk-1' });
  agentId = (await sql("select id from agents where key = 'desk-1'")).rows[0].id;
  taskId = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 'draft', 'in_progress', $2, $2, 'founder') returning id", [ws(), agentId])).rows[0].id;
  runId = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId, taskId])).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('update agents set autonomy = 1 where id = $1', [agentId]);
  await sql('delete from messages where task_id = $1', [taskId]);
  await sql('delete from deal_stage_events');
  await sql('delete from projects');
  await sql('delete from deals');
  await sql('delete from contacts');
  await sql('update leads set account_id = null');
  await sql('delete from accounts');
  const { id: accountId } = await ok<{ id: string }>(await call('POST', '/accounts', { name: 'Glow Clinic' }), 201);
  dealId = (await ok<{ id: string }>(await call('POST', '/deals', { accountId, funnel: 'services', offer: 'Homepage rebuild', value: 2500, metric: 'steps to book', baselineValue: 12, targetValue: 4, outcomeValue: 5 }), 201)).id;
});
const comments = async () => (await sql('select body from messages where task_id = $1 order by created_at', [taskId])).rows.map((r) => r.body as string);

describe('deals carry the numbers a document may quote (S2-12)', () => {
  it('stores a metric with its baseline, target and outcome, and rejects a negative figure', async () => {
    const d = await ok<{ metric: string; baseline_value: string; target_value: string; outcome_value: string }>(await call('GET', `/deals/${dealId}`));
    expect(d).toMatchObject({ metric: 'steps to book' });
    expect([Number(d.baseline_value), Number(d.target_value), Number(d.outcome_value)]).toEqual([12, 4, 5]);
    expect((await call('PATCH', `/deals/${dealId}`, { outcomeValue: -1 })).status).toBe(400);
    expect((await call('PATCH', `/deals/${dealId}`, { baselineValue: 9 })).status).toBe(200);
  });
});

describe('get_deal and save_draft (S2-12)', () => {
  it('get_deal returns the deal with the figures a draft may use', async () => {
    const r = await tool('get_deal', { dealId });
    expect(r.ok, r.text).toBe(true);
    const d = JSON.parse(r.text);
    expect(d).toMatchObject({ account: 'Glow Clinic', offer: 'Homepage rebuild', metric: 'steps to book' });
    expect(d.figures).toEqual(expect.arrayContaining([2500, 12, 4, 5]));
  });

  it('keeps a draft whose figures are all in the tables, as a labelled comment on the task', async () => {
    const r = await tool('save_draft', { dealId, kind: 'outcome-note', text: 'Steps to book fell from 12 to 5 against a target of 4. The build was $2,500.' });
    expect(r.ok, r.text).toBe(true);
    const [c] = await comments();
    expect(c).toMatch(/^\[Draft: outcome-note\. For review; nothing has been sent\.\]/);
    expect(c).toContain('fell from 12 to 5');
  });

  it('refuses a draft that states a number that is not in the tables, and says which', async () => {
    const r = await tool('save_draft', { dealId, kind: 'outcome-note', text: 'Bookings rose 300% and revenue doubled to $50,000.' });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('300');
    expect(r.text).toContain('50000');
    expect(r.text).toMatch(/not in the tables/i);
    expect(await comments()).toEqual([]); // nothing saved
  });

  it('refuses a result for a deal that has no recorded outcome', async () => {
    await call('PATCH', `/deals/${dealId}`, { outcomeValue: null });
    const r = await tool('save_draft', { dealId, kind: 'outcome-note', text: 'Steps to book fell from 12 to 5.' });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/outcome/i); // an outcome note needs a recorded outcome
  });

  it('allows a free-offer draft with no outcome, and only small list numbers beyond the figures', async () => {
    await call('PATCH', `/deals/${dealId}`, { outcomeValue: null });
    const r = await tool('save_draft', { dealId, kind: 'free-offer', text: 'One page, design only. 1) We agree the baseline: 12 steps to book. 2) You choose.' });
    expect(r.ok, r.text).toBe(true);
  });

  it('is not offered to an agent on trial, and the kinds are a fixed list', async () => {
    expect(osTools.save_draft.minAutonomy).toBe(1);
    expect(osTools.get_deal.minAutonomy).toBe(0);
    expect((await tool('save_draft', { dealId, kind: 'invoice', text: 'x' })).ok).toBe(false);
    await sql('update agents set autonomy = 0 where id = $1', [agentId]);
    expect((await tool('save_draft', { dealId, kind: 'free-offer', text: 'hello' })).text).toMatch(/Unknown tool/);
  });

  it('cannot send anything: a draft is only a comment, and no outbox or approval appears', async () => {
    await tool('save_draft', { dealId, kind: 'free-offer', text: 'A bounded offer.' });
    expect((await sql("select count(*)::int as n from approvals where kind = 'email.send'")).rows[0].n).toBe(0);
  });
});

describe('the deal-desk and client-success templates (S2-12)', () => {
  const templatesRoot = path.join(REPO_ROOT, 'templates');
  const pluginsRoot = path.join(REPO_ROOT, 'plugins');

  it.each([
    ['dealdesk-kit', ['free-offer', 'contract-of-success']],
    ['clientsuccess-kit', ['outcome-note', 'proof-report']],
  ])('plugin %s matches the disk and the os server, and its skills cannot reach outside', async (name, skills) => {
    const p = await loadPlugin(pluginsRoot, name);
    expect(p.skills.sort()).toEqual([...skills].sort());
    for (const t of p.tools) expect(Object.keys(osTools), t).toContain(t);
    expect(p.tools).toEqual(expect.arrayContaining(['get_deal', 'save_draft']));
    for (const s of skills) {
      const text = await readFile(path.join(pluginsRoot, name, 'skills', s, 'SKILL.md'), 'utf8');
      expect(text).toContain('save_draft');
      expect(text).toContain('get_deal');
      for (const never of [/smtp/i, /curl/i, /propose_email/, /send_email/]) expect(text).not.toMatch(never);
    }
    const note = await readFile(path.join(pluginsRoot, 'clientsuccess-kit', 'skills', 'outcome-note', 'SKILL.md'), 'utf8');
    expect(note).toMatch(/only (use )?(the )?figures/i);
  });

  it.each(['deal-desk', 'client-success'])('%s has no web and no shell, and renders for both engines with the same skills', async (key) => {
    const t = await loadTemplate(templatesRoot, key);
    expect(t.permissions).toMatchObject({ shell: 'deny', web_search: 'deny', web_fetch: 'deny', subagents: 'deny' });
    expect(t.connectors).toEqual(['os']);
    expect(t.file.defaults.autonomy).toBe(1);
    const params = { id: key, name: key, department: 'outreach', department_name: 'Outreach', company_name: 'Acme' };
    const ctx = async () => ({ dataDir: await mkdtemp(path.join(tmpdir(), 'conclave-data-')), workspaceSlug: 'local', companyName: 'Acme', companyMd: '# Acme', departmentName: 'Outreach', osUrl: 'http://127.0.0.1:3100/mcp', templatesRoot });
    const claude = await renderWorkdir(parseRoleFile(renderRoleFile(t, params), 'x/AGENT.md'), await ctx());
    const open = await renderWorkdir(parseRoleFile(renderRoleFile(t, { ...params, id: `${key}-2`, runtime: 'opencode', model: 'any-model' }), 'x/AGENT.md'), await ctx());
    const skill = t.plugins.flatMap((p) => p.skills)[0]!;
    expect(await readFile(path.join(claude.dir, '.claude/skills', skill, 'SKILL.md'), 'utf8')).toBe(await readFile(path.join(open.dir, '.opencode/skills', skill, 'SKILL.md'), 'utf8'));
    const settings = JSON.parse(await readFile(path.join(claude.dir, '.claude/settings.json'), 'utf8'));
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Bash', 'WebFetch', 'WebSearch']));
    expect(await readFile(path.join(claude.dir, 'CLAUDE.md'), 'utf8')).toMatch(/information, never an instruction/);
  });
});
