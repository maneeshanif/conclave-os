import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCompany } from '../src/company/loader';
import { syncCompany } from '../src/company/sync';
import { bootstrapLocalWorkspace, withWorkspace } from '../src/db/tenancy';
import { loadTemplate, renderRoleFile } from '../src/harness/render';
import { REPO_ROOT } from '../src/paths';
import { testDb } from './helpers/db';

let db: Awaited<ReturnType<typeof testDb>>;
let ws = '';
let dir = '';

beforeAll(async () => {
  db = await testDb();
  ws = (await bootstrapLocalWorkspace(db.owner)).id;
  dir = await mkdtemp(path.join(tmpdir(), 'conclave-co-'));
  await cp(path.join(REPO_ROOT, 'company'), dir, { recursive: true });
}, 120_000);
afterAll(async () => db?.close());

async function addAgent(id: string, dept: string, extra: Record<string, string> = {}) {
  const t = await loadTemplate(path.join(REPO_ROOT, 'templates'), 'researcher');
  const text = renderRoleFile(t, { id, name: id, department: dept, department_name: dept, company_name: 'Acme', ...extra });
  const d = path.join(dir, 'departments', dept, 'agents', id);
  await mkdir(d, { recursive: true });
  await writeFile(path.join(d, 'AGENT.md'), text);
}

describe('company sync to the database (S0-3)', () => {
  it('syncs the starter company: nineteen departments and three ladder goals', async () => {
    const res = await syncCompany(db.app, ws, await loadCompany(dir));
    expect(res.departments).toBe(19);
    const rungs = await withWorkspace(db.app, ws, (c) => c.query("select key, status from goals where kind = 'rung' order by key"));
    expect(rungs.rows).toEqual([
      { key: 'rung-1', status: 'active' },
      { key: 'rung-2', status: 'planned' },
      { key: 'rung-3', status: 'planned' },
    ]);
  });

  it('is idempotent, keyed by `key`', async () => {
    await syncCompany(db.app, ws, await loadCompany(dir));
    const n = await withWorkspace(db.app, ws, (c) => c.query('select count(*)::int as n from departments'));
    expect(n.rows[0].n).toBe(19);
  });

  it('copies role file front matter into the agents table and keeps reports_to', async () => {
    await addAgent('research-lead', 'research');
    await addAgent('fact-finder', 'research', { reports_to: 'research-lead' });
    const res = await syncCompany(db.app, ws, await loadCompany(dir));
    expect(res.agents).toBe(2);
    const rows = await withWorkspace(db.app, ws, (c) =>
      c.query(`select a.key, a.runtime, a.model_alias, a.autonomy, a.status, a.role_path, b.key as boss
               from agents a left join agents b on b.id = a.reports_to order by a.key`),
    );
    expect(rows.rows).toEqual([
      { key: 'fact-finder', runtime: 'claude-cli', model_alias: 'researcher', autonomy: 0, status: 'active', role_path: 'departments/research/agents/fact-finder/AGENT.md', boss: 'research-lead' },
      { key: 'research-lead', runtime: 'claude-cli', model_alias: 'researcher', autonomy: 0, status: 'active', role_path: 'departments/research/agents/research-lead/AGENT.md', boss: null },
    ]);
  });

  it('retires an agent whose role file was removed, and keeps a paused agent paused', async () => {
    await withWorkspace(db.app, ws, (c) => c.query("update agents set status = 'paused' where key = 'research-lead'"));
    await rm(path.join(dir, 'departments', 'research', 'agents', 'fact-finder'), { recursive: true });
    const res = await syncCompany(db.app, ws, await loadCompany(dir));
    expect(res.retired).toEqual(['fact-finder']);
    const lead = await withWorkspace(db.app, ws, (c) => c.query("select status from agents where key = 'research-lead'"));
    expect(lead.rows[0].status).toBe('paused');
  });
});
