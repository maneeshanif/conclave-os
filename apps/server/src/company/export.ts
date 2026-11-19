import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadCompany } from './loader';

/**
 * Exporting a company as a template (S9-4, SPEC 16): the company folder (its text, goals, departments, agents and map) plus the list of
 * plugins its agents use, with anything that looks like a secret taken out. Importing is making a company from the template, which
 * `Companies.create` already does. The export never writes into an existing template, and never reads outside the company folder.
 */
const SECRET: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, 'an API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'a GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, 'a Slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'an AWS key'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, 'a bearer token'],
  [/([A-Za-z0-9_]*(?:api[_-]?key|secret|token|password|passwd))(\s*[:=]\s*)(["']?)[^\s"']{8,}\3/gi, 'a named secret'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'a private key'],
];

/** The text with every secret replaced by a marker, and what was found. */
export function scrub(text: string): { text: string; found: string[] } {
  const found: string[] = [];
  let out = text;
  for (const [re, what] of SECRET) {
    out = out.replace(re, (m, ...g: string[]) => {
      found.push(what);
      return what === 'a named secret' ? `${g[0]}${g[1]}TODO-removed` : 'TODO-removed';
    });
  }
  return { text: out, found };
}

const SKIP = new Set(['.git', 'node_modules', '.env', 'ledger', 'metrics', 'reliability']);
const TEXT = /\.(md|ya?ml|json|tmj|txt|hbs|toml)$/i;

async function* files(dir: string, rel = ''): AsyncGenerator<string> {
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.env')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* files(dir, r);
    else if (e.isFile()) yield r;
  }
}

export interface ExportReport {
  template: string;
  files: number;
  plugins: string[];
  removed: { file: string; what: string }[];
}

export async function exportCompanyTemplate(companyRoot: string, templatesRoot: string, name: string): Promise<ExportReport> {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) throw new Error('A template name is lower-case letters, digits and dashes.');
  const dest = path.join(templatesRoot, 'companies', name);
  if (await stat(dest).then(() => true, () => false)) throw new Error(`There is already a company template called "${name}". Pick another name; an export never overwrites.`);
  const company = await loadCompany(companyRoot); // refuses a company folder that does not load
  const plugins = [...new Set(company.agents.flatMap((a) => a.role.plugins ?? []))].sort();
  const removed: ExportReport['removed'] = [];
  let count = 0;
  await mkdir(dest, { recursive: true });
  for await (const rel of files(companyRoot)) {
    const from = path.join(companyRoot, rel);
    const to = path.join(dest, rel);
    await mkdir(path.dirname(to), { recursive: true });
    if (TEXT.test(rel)) {
      const s = scrub(await readFile(from, 'utf8'));
      for (const what of new Set(s.found)) removed.push({ file: rel, what });
      await writeFile(to, s.text);
    } else {
      await writeFile(to, await readFile(from));
    }
    count++;
  }
  await writeFile(path.join(dest, 'template.json'), JSON.stringify({ name, plugins, exportedFrom: 'a Conclave OS company folder', note: 'Secrets are removed. Fill in the TODO lines, then make a company from this template.' }, null, 2) + '\n');
  return { template: name, files: count + 1, plugins, removed };
}
