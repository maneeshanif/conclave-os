import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Companies, CompanyError } from '../src/companies';
import { withWorkspace } from '../src/db/tenant';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

let sys: System;
let companies: Companies;
const q = (ws: string, sql: string, p: unknown[] = []) => withWorkspace(sys.app, ws, ({ client }) => client.query(sql, p));

beforeAll(async () => {
  ({ sys } = await testSystem());
  companies = new Companies({ dataDir: sys.dataDir, templatesRoot: sys.templatesRoot, pool: sys.app, defaultCompany: { id: sys.workspace.id, slug: sys.workspace.slug, root: sys.companyRoot } });
}, 240_000);
afterAll(async () => sys?.close());

describe('the list of companies (S6-13a)', () => {
  it('starts with the one company the server runs, named from its COMPANY.md', async () => {
    const list = await companies.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: sys.workspace.id, slug: 'local', isDefault: true, root: sys.companyRoot });
    expect(list[0]!.name.length).toBeGreaterThan(0);
  });

  it('offers the company templates in the templates folder', async () => {
    expect(await companies.templates()).toContain('starter');
  });

  it('finds a company by id and says nothing for an unknown or malformed id', async () => {
    expect((await companies.get(sys.workspace.id))?.slug).toBe('local');
    expect(await companies.get('11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(await companies.get('not-an-id')).toBeNull();
    expect(await companies.get('')).toBeNull();
  });
});

describe('making a company from a template (S6-13a)', () => {
  it('copies the template to its own folder, names it, makes its workspace and its departments, and lists it', async () => {
    const c = await companies.create({ name: 'Acme Studio', template: 'starter' });
    expect(c).toMatchObject({ slug: 'acme-studio', name: 'Acme Studio', isDefault: false });
    expect(c.root).toBe(path.join(sys.dataDir, 'companies', 'acme-studio', 'company'));
    expect((await readFile(path.join(c.root, 'COMPANY.md'), 'utf8')).split('\n')[0]).toBe('# Acme Studio');
    expect(existsSync(path.join(c.root, 'office.tmj'))).toBe(true);
    expect((await q(c.id, 'select name, slug from workspaces')).rows).toEqual([{ name: 'Acme Studio', slug: 'acme-studio' }]);
    const depts = (await q(c.id, 'select key from departments order by key')).rows.map((r) => r.key);
    expect(depts).toEqual(['chief-of-staff', 'lead-gen', 'outreach', 'research']);
    expect((await companies.list()).map((x) => x.slug)).toEqual(['local', 'acme-studio']);
  });

  it('keeps the list across a restart: it is read from the data folder, not held in memory', async () => {
    const again = new Companies({ dataDir: sys.dataDir, templatesRoot: sys.templatesRoot, pool: sys.app, defaultCompany: { id: sys.workspace.id, slug: 'local', root: sys.companyRoot } });
    expect((await again.list()).map((x) => x.slug)).toContain('acme-studio');
  });

  it('gives a second company with the same name its own slug', async () => {
    const c = await companies.create({ name: 'Acme Studio', template: 'starter' });
    expect(c.slug).toBe('acme-studio-2');
  });

  it('keeps one company\'s data out of another: neither workspace can read the other\'s rows', async () => {
    const [, a, b] = await companies.list();
    for (const [mine, other] of [[a!, b!], [b!, a!], [a!, { id: sys.workspace.id }]] as const) {
      expect((await q(mine.id, 'select id from workspaces where id = $1', [other.id])).rows).toHaveLength(0);
      expect((await q(mine.id, 'select id from departments where workspace_id = $1', [other.id])).rows).toHaveLength(0);
    }
    expect((await q(sys.workspace.id, 'select id from workspaces')).rows).toHaveLength(1);
  });

  it('refuses a name that is empty, too long or has nothing a folder could be named from', async () => {
    for (const name of ['', '   ', 'x'.repeat(61), '!!!']) {
      await expect(companies.create({ name, template: 'starter' }), name).rejects.toBeInstanceOf(CompanyError);
    }
  });

  it('never puts a folder outside the companies folder, whatever the name looks like', async () => {
    const c = await companies.create({ name: '../../outside', template: 'starter' });
    expect(c.slug).toBe('outside');
    expect(path.relative(path.join(sys.dataDir, 'companies'), c.root).startsWith('..')).toBe(false);
  });

  it('refuses a template that is not in the templates folder, including a path out of it, and makes nothing', async () => {
    const before = await readdir(path.join(sys.dataDir, 'companies'));
    const n = (await companies.list()).length;
    for (const template of ['nope', '../agents', '..', 'starter/../../..', '', 'Starter']) {
      await expect(companies.create({ name: 'Zed Co', template }), template).rejects.toBeInstanceOf(CompanyError);
    }
    expect(await readdir(path.join(sys.dataDir, 'companies'))).toEqual(before);
    expect((await companies.list()).length).toBe(n);
  });

  it('makes nothing if the template does not load: no folder, no workspace, no entry', async () => {
    const templates = await mkdtemp(path.join(tmpdir(), 'conclave-tpl-'));
    try {
      await mkdir(path.join(templates, 'companies'), { recursive: true });
      await cp(path.join(sys.templatesRoot, 'companies', 'starter'), path.join(templates, 'companies', 'broken'), { recursive: true });
      await writeFile(path.join(templates, 'companies', 'broken', 'departments.yaml'), 'departments: nope\n');
      const c2 = new Companies({ dataDir: sys.dataDir, templatesRoot: templates, pool: sys.app, defaultCompany: { id: sys.workspace.id, slug: 'local', root: sys.companyRoot } });
      const before = (await companies.list()).length;
      await expect(c2.create({ name: 'Broken Co', template: 'broken' })).rejects.toBeInstanceOf(CompanyError);
      expect(existsSync(path.join(sys.dataDir, 'companies', 'broken-co'))).toBe(false);
      expect((await companies.list()).length).toBe(before);
    } finally {
      await rm(templates, { recursive: true, force: true });
    }
  });
});
