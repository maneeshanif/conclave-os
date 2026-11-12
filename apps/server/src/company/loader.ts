import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { aliasWorksOn } from '../config/models';
import {
  DepartmentsFileSchema,
  FunnelsFileSchema,
  GoalsFileSchema,
  type Funnel,
  RoleFileSchema,
  type Department,
  type GoalsFile,
  type RoleFile,
} from './schema';

export interface LoadedAgent {
  role: RoleFile;
  /** Markdown body of the role file, below the front matter. */
  body: string;
  /** Path relative to the company folder, with forward slashes. */
  rolePath: string;
}

export interface Company {
  root: string;
  companyMd: string;
  departments: Department[];
  goals: GoalsFile;
  /** From funnels.yaml. Empty when the company has no such file. */
  funnels: Funnel[];
  agents: LoadedAgent[];
}

export class CompanyLoadError extends Error {
  constructor(
    public readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'CompanyLoadError';
  }
}

function formatZod(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`).join('; ');
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function parseWith<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new CompanyLoadError(file, formatZod(parsed.error));
  return parsed.data;
}

async function readYaml(root: string, rel: string): Promise<unknown> {
  try {
    return parseYaml(await readFile(path.join(root, rel), 'utf8'));
  } catch (err) {
    throw new CompanyLoadError(rel, (err as Error).message);
  }
}

/** Splits `---\nfront matter\n---\nbody`. */
export function splitFrontMatter(text: string, file: string): { data: unknown; body: string } {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) throw new CompanyLoadError(file, 'missing front matter between --- lines');
  try {
    return { data: parseYaml(match[1] ?? ''), body: (match[2] ?? '').trim() };
  } catch (err) {
    throw new CompanyLoadError(file, `front matter is not valid YAML: ${(err as Error).message}`);
  }
}

export function parseRoleFile(text: string, rolePath: string): LoadedAgent {
  const { data, body } = splitFrontMatter(text, rolePath);
  const role = parseWith(RoleFileSchema, data, rolePath);
  if (!aliasWorksOn(role.model, role.runtime)) {
    throw new CompanyLoadError(
      rolePath,
      `model alias "${role.model}" does not list runtime "${role.runtime}". Pick an alias that works on ${role.runtime}.`,
    );
  }
  if (role.fallback_model && !aliasWorksOn(role.fallback_model, role.runtime)) {
    throw new CompanyLoadError(
      rolePath,
      `fallback alias "${role.fallback_model}" does not list runtime "${role.runtime}".`,
    );
  }
  return { role, body, rolePath };
}

/** Reads and validates the company folder (SPEC 5, 13). Pure: touches no database. */
export async function loadCompany(root: string): Promise<Company> {
  const companyMd = await readFile(path.join(root, 'COMPANY.md'), 'utf8').catch(() => {
    throw new CompanyLoadError('COMPANY.md', 'file not found');
  });
  const { departments } = parseWith(DepartmentsFileSchema, await readYaml(root, 'departments.yaml'), 'departments.yaml');
  const goals = parseWith(GoalsFileSchema, await readYaml(root, 'goals.yaml'), 'goals.yaml');

  const deptKeys = new Set<string>();
  for (const d of departments) {
    if (deptKeys.has(d.key)) throw new CompanyLoadError('departments.yaml', `department "${d.key}" is listed twice`);
    deptKeys.add(d.key);
  }
  const rungIds = new Set(goals.ladder.map((r) => r.id));
  if (!rungIds.has(goals.current_rung)) {
    throw new CompanyLoadError('goals.yaml', `current_rung "${goals.current_rung}" is not on the ladder`);
  }
  for (const [dept, g] of Object.entries(goals.department_goals)) {
    if (!deptKeys.has(dept)) throw new CompanyLoadError('goals.yaml', `department_goals names unknown department "${dept}"`);
    if (!rungIds.has(g.serves)) throw new CompanyLoadError('goals.yaml', `department_goals.${dept} serves unknown rung "${g.serves}"`);
  }

  let funnels: Funnel[] = [];
  if (await exists(path.join(root, 'funnels.yaml'))) {
    funnels = parseWith(FunnelsFileSchema, await readYaml(root, 'funnels.yaml'), 'funnels.yaml').funnels;
    const seen = new Set<string>();
    for (const f of funnels) {
      if (seen.has(f.key)) throw new CompanyLoadError('funnels.yaml', `funnel "${f.key}" is listed twice`);
      seen.add(f.key);
      const stageKeys = new Set<string>();
      for (const st of f.stages) {
        if (stageKeys.has(st.key)) throw new CompanyLoadError('funnels.yaml', `funnel "${f.key}" lists stage "${st.key}" twice`);
        stageKeys.add(st.key);
      }
    }
  }

  const agents: LoadedAgent[] = [];
  const deptRoot = path.join(root, 'departments');
  if (await exists(deptRoot)) {
    for (const dept of (await readdir(deptRoot)).sort()) {
      const agentsDir = path.join(deptRoot, dept, 'agents');
      if (!(await exists(agentsDir))) continue;
      for (const id of (await readdir(agentsDir)).sort()) {
        const rel = ['departments', dept, 'agents', id, 'AGENT.md'].join('/');
        const file = path.join(root, rel);
        if (!(await exists(file))) continue;
        const agent = parseRoleFile(await readFile(file, 'utf8'), rel);
        if (agent.role.id !== id) throw new CompanyLoadError(rel, `id "${agent.role.id}" does not match its folder "${id}"`);
        if (agent.role.department !== dept) {
          throw new CompanyLoadError(rel, `department "${agent.role.department}" does not match its folder "${dept}"`);
        }
        if (!deptKeys.has(dept)) throw new CompanyLoadError(rel, `department "${dept}" is not in departments.yaml`);
        agents.push(agent);
      }
    }
  }
  const agentIds = new Set(agents.map((a) => a.role.id));
  for (const a of agents) {
    if (a.role.reports_to && !agentIds.has(a.role.reports_to)) {
      throw new CompanyLoadError(a.rolePath, `reports_to "${a.role.reports_to}" is not an agent in this company`);
    }
  }

  return { root, companyMd, departments, goals, funnels, agents };
}
