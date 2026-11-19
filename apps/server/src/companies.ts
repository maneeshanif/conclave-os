import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { z } from 'zod';
import { CompanyLoadError, loadCompany } from './company/loader';
import { syncCompany } from './company/sync';
import { withWorkspace } from './db/tenant';
import { companyName } from './system';

/**
 * Many companies (SPEC 3, 11, 13). A company is a workspace in the database and a company folder on disk. The list of companies is a
 * small file in the data folder, not a table: row-level security hides every other workspace from the app's own connection, which is
 * the point of it, so a list that spans them cannot live there. Each company's text lives under `DATA_DIR/companies/<slug>/company`;
 * the one the server was started for keeps its own folder (the repo's `company/` unless COMPANY_DIR says otherwise).
 */
export interface Company {
  id: string;
  slug: string;
  name: string;
  /** The company folder: COMPANY.md, departments.yaml, goals.yaml, office.tmj and the agents' role files. */
  root: string;
  isDefault: boolean;
}

/** A refusal with a message a person can read. */
export class CompanyError extends Error {}

export interface CompaniesDeps {
  dataDir: string;
  templatesRoot: string;
  pool: Pool;
  defaultCompany: { id: string; slug: string; root: string };
}

const Entry = z.object({ id: z.uuid(), slug: z.string(), name: z.string(), root: z.string(), createdAt: z.string() });
const File = z.object({ companies: z.array(Entry) });
const ID = z.uuid();
const TEMPLATE = /^[a-z0-9][a-z0-9-]*$/;

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

export class Companies {
  constructor(private readonly deps: CompaniesDeps) {}

  private get file() {
    return path.join(this.deps.dataDir, 'companies.json');
  }

  private async read(): Promise<z.infer<typeof Entry>[]> {
    try {
      return File.parse(JSON.parse(await readFile(this.file, 'utf8'))).companies;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new CompanyError(`The list of companies (${this.file}) cannot be read: ${(err as Error).message}`);
    }
  }

  /** Written to a temporary file first and moved into place, so a crash cannot leave half a list. */
  private async write(list: z.infer<typeof Entry>[]): Promise<void> {
    await mkdir(this.deps.dataDir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ companies: list }, null, 2) + '\n');
    await rename(tmp, this.file);
  }

  /** The company the server runs first, then the others in the order they were made. */
  async list(): Promise<Company[]> {
    const d = this.deps.defaultCompany;
    const first: Company = { id: d.id, slug: d.slug, name: await companyName(d.root), root: d.root, isDefault: true };
    return [first, ...(await this.read()).map((e) => ({ id: e.id, slug: e.slug, name: e.name, root: e.root, isDefault: false }))];
  }

  async get(id: string): Promise<Company | null> {
    if (!ID.safeParse(id).success) return null;
    return (await this.list()).find((c) => c.id === id) ?? null;
  }

  /** The names of the company templates (folders under templates/companies). */
  async templates(): Promise<string[]> {
    const dir = path.join(this.deps.templatesRoot, 'companies');
    const names = await readdir(dir, { withFileTypes: true }).catch(() => []);
    return names.filter((n) => n.isDirectory() && TEMPLATE.test(n.name)).map((n) => n.name).sort();
  }

  /**
   * Makes a company from a template: copies the folder, names it, checks that it loads, makes the workspace and its departments,
   * and adds it to the list. If any step fails, nothing is left behind.
   */
  async create(input: { name: string; template: string }): Promise<Company> {
    const name = input.name.trim();
    if (!name) throw new CompanyError('Give the company a name.');
    if (name.length > 60) throw new CompanyError('A company name can be at most 60 characters.');
    const base = slugify(name);
    if (!base) throw new CompanyError('The name needs some letters or numbers in it.');
    if (!TEMPLATE.test(input.template) || !(await this.templates()).includes(input.template)) throw new CompanyError(`There is no company template called "${input.template}".`);

    const taken = new Set((await this.list()).map((c) => c.slug));
    let slug = base;
    for (let n = 2; taken.has(slug) || existsSync(path.join(this.deps.dataDir, 'companies', slug)); n++) slug = `${base}-${n}`;
    const id = randomUUID();
    const home = path.join(this.deps.dataDir, 'companies', slug);
    const root = path.join(home, 'company');
    try {
      await cp(path.join(this.deps.templatesRoot, 'companies', input.template), root, { recursive: true });
      await rm(path.join(root, 'README.md'), { force: true });
      const md = path.join(root, 'COMPANY.md');
      await writeFile(md, (await readFile(md, 'utf8')).replaceAll('{{company_name}}', name));
      const company = await loadCompany(root);
      // The app's own connection may add exactly the workspace it is acting as (the policy checks the new row's id), so name the id first.
      await withWorkspace(this.deps.pool, id, ({ client }) => client.query("insert into workspaces (id, name, slug, mode) values ($1, $2, $3, 'local')", [id, name, slug]));
      await syncCompany(this.deps.pool, id, company);
      await this.write([...(await this.read()), { id, slug, name, root, createdAt: new Date().toISOString() }]);
      return { id, slug, name, root, isDefault: false };
    } catch (err) {
      await rm(home, { recursive: true, force: true });
      await withWorkspace(this.deps.pool, id, async ({ client }) => {
        await client.query('delete from departments where workspace_id = $1', [id]);
        await client.query('delete from workspaces where id = $1', [id]);
      }).catch(() => undefined);
      if (err instanceof CompanyLoadError) throw new CompanyError(`The template does not load: ${err.message}`);
      throw err;
    }
  }
}
