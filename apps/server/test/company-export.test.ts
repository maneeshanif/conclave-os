import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportCompanyTemplate, scrub } from '../src/company/export';
import { loadCompany } from '../src/company/loader';
import { REPO_ROOT } from '../src/paths';

/** Exporting a company as a template (S9-4). */
let root = '';
const company = path.join(REPO_ROOT, 'company');

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'conclave-exp-'));
  await cp(company, path.join(root, 'company'), { recursive: true });
});
afterAll(() => rm(root, { recursive: true, force: true }));

const walk = async (dir: string, rel = ''): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    out.push(...(e.isDirectory() ? await walk(dir, r) : [r]));
  }
  return out.sort();
};

describe('scrubbing (S9-4)', () => {
  it('takes out keys, tokens, bearer headers, named secrets and private keys, and leaves ordinary text alone', () => {
    const text = 'We use sk-abcdefghijklmnop1234 and ghp_abcdefghijklmnopqrstuv. Authorization: Bearer abcdefghijklmnop1234567. RESEND_API_KEY=re_live_12345678 and password: "hunter2hunter2".\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\nOur price is 500 dollars and our token of thanks is a free homepage.';
    const s = scrub(text);
    for (const secret of ['sk-abcdefghijklmnop1234', 'ghp_abcdefghijklmnopqrstuv', 'abcdefghijklmnop1234567', 're_live_12345678', 'hunter2hunter2', 'BEGIN PRIVATE KEY']) expect(s.text, secret).not.toContain(secret);
    expect(s.text).toContain('Our price is 500 dollars and our token of thanks is a free homepage.');
    expect(new Set(s.found).size).toBeGreaterThanOrEqual(5);
  });
});

describe('exporting a company (S9-4)', () => {
  it('writes the same departments, agents and map as a template that loads, with the plugin list, and a planted secret removed', async () => {
    await writeFile(path.join(root, 'company', 'COMPANY.md'), `${await readFile(path.join(company, 'COMPANY.md'), 'utf8')}\nInternal: RESEND_API_KEY=re_live_planted_secret_1\n`);
    const templates = path.join(root, 'templates');
    const report = await exportCompanyTemplate(path.join(root, 'company'), templates, 'my-export');
    const out = path.join(templates, 'companies', 'my-export');
    expect(report.removed).toEqual(expect.arrayContaining([{ file: 'COMPANY.md', what: 'a named secret' }]));
    expect(await readFile(path.join(out, 'COMPANY.md'), 'utf8')).not.toContain('re_live_planted_secret_1');

    const a = await loadCompany(path.join(root, 'company'));
    const b = await loadCompany(out);
    expect(b.departments.map((d) => [d.key, d.active, d.room])).toEqual(a.departments.map((d) => [d.key, d.active, d.room]));
    expect(b.agents.map((x) => x.role.id).sort()).toEqual(a.agents.map((x) => x.role.id).sort());
    expect(await readFile(path.join(out, 'office.tmj'), 'utf8')).toBe(await readFile(path.join(root, 'company', 'office.tmj'), 'utf8'));
    const meta = JSON.parse(await readFile(path.join(out, 'template.json'), 'utf8')) as { plugins: string[] };
    expect(meta.plugins).toEqual(report.plugins);
    expect(report.plugins).toEqual(expect.arrayContaining(['dev-kit', 'leadgen-kit']));
    const names = await walk(out);
    expect(names.some((n) => n.includes('.env') || n.startsWith('.git/'))).toBe(false);
  });

  it('never overwrites an existing template, and refuses a bad name or a folder that does not load', async () => {
    const templates = path.join(root, 'templates');
    await expect(exportCompanyTemplate(path.join(root, 'company'), templates, 'my-export')).rejects.toThrow(/already/);
    await expect(exportCompanyTemplate(path.join(root, 'company'), templates, '../escape')).rejects.toThrow(/lower-case/);
    await expect(exportCompanyTemplate(path.join(root, 'nowhere'), templates, 'empty-one')).rejects.toThrow();
  });
});
