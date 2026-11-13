import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadCompany } from '../company/loader';
import { syncCompany } from '../company/sync';
import { loadTemplate, renderRoleFile, renderWorkdir } from '../harness/render';
import type { RuntimeName } from '../runtimes/names';
import { companyName, type System } from '../system';

export interface AgentNewOptions {
  template: string;
  department: string;
  id?: string;
  name?: string;
  runtime?: RuntimeName;
  model?: string;
  /** Starting level, 0 to 3. Without it the template's level (0: on trial) applies. */
  autonomy?: number;
  reportsTo?: string;
}

export interface AgentNewResult {
  id: string;
  rolePath: string;
  workDir: string;
  runtime: RuntimeName;
  autonomy: number;
}

const title = (s: string) => s.replace(/(^|-)([a-z])/g, (_, sep: string, ch: string) => (sep ? ' ' : '') + ch.toUpperCase());

/** `pnpm agent:new <template> --department <key>`: renders a role file and working folder, then registers the agent (S0-4). */
export async function agentNew(sys: System, opts: AgentNewOptions): Promise<AgentNewResult> {
  const company = await loadCompany(sys.companyRoot);
  const dept = company.departments.find((d) => d.key === opts.department);
  if (!dept) throw new Error(`Unknown department "${opts.department}". Known: ${company.departments.map((d) => d.key).join(', ')}`);
  const t = await loadTemplate(sys.templatesRoot, opts.template);

  let id = opts.id ?? `${opts.department}-${opts.template}`;
  const taken = new Set(company.agents.map((a) => a.role.id));
  if (opts.id && taken.has(id)) throw new Error(`An agent with id "${id}" already exists.`);
  for (let n = 2; !opts.id && taken.has(id); n++) id = `${opts.department}-${opts.template}-${n}`;

  const text = renderRoleFile(t, {
    id,
    name: opts.name ?? title(opts.template),
    department: dept.key,
    department_name: dept.name,
    company_name: await companyName(sys.companyRoot),
    ...(opts.reportsTo ? { reports_to: opts.reportsTo } : {}),
    ...(opts.runtime ? { runtime: opts.runtime } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.autonomy !== undefined ? { autonomy: opts.autonomy } : {}),
  });
  const rel = ['departments', dept.key, 'agents', id, 'AGENT.md'].join('/');
  const file = path.join(sys.companyRoot, rel);
  if (existsSync(file)) throw new Error(`${rel} already exists.`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');

  const reloaded = await loadCompany(sys.companyRoot);
  await syncCompany(sys.app, sys.workspace.id, reloaded);
  const agent = reloaded.agents.find((a) => a.role.id === id)!;
  const out = await renderWorkdir(agent, {
    dataDir: sys.dataDir,
    workspaceSlug: sys.workspace.slug,
    companyName: await companyName(sys.companyRoot),
    companyMd: reloaded.companyMd,
    departmentName: dept.name,
    osUrl: sys.osUrl,
    templatesRoot: sys.templatesRoot,
  });
  return { id, rolePath: rel, workDir: out.dir, runtime: out.runtime, autonomy: agent.role.autonomy };
}

/** Renders every agent's working folder again, for the runtime its role file names now. */
export async function renderAll(sys: System): Promise<AgentNewResult[]> {
  const company = await loadCompany(sys.companyRoot);
  await syncCompany(sys.app, sys.workspace.id, company);
  const name = await companyName(sys.companyRoot);
  const out: AgentNewResult[] = [];
  for (const a of company.agents) {
    if (!a.role.template) continue;
    const dept = company.departments.find((d) => d.key === a.role.department)!;
    const r = await renderWorkdir(a, {
      dataDir: sys.dataDir,
      workspaceSlug: sys.workspace.slug,
      companyName: name,
      companyMd: company.companyMd,
      departmentName: dept.name,
      osUrl: sys.osUrl,
      templatesRoot: sys.templatesRoot,
    });
    out.push({ id: a.role.id, rolePath: a.rolePath, workDir: r.dir, runtime: r.runtime, autonomy: a.role.autonomy });
  }
  return out;
}

/**
 * Renders one agent's folder again from the role file on disk, before a run. A run never starts on a
 * folder the agent itself may have edited during an earlier run (SPEC 5).
 */
export async function renderOne(sys: System, agentKey: string, over?: { runtime: RuntimeName; model: string }): Promise<void> {
  const company = await loadCompany(sys.companyRoot);
  const a = company.agents.find((x) => x.role.id === agentKey);
  if (!a?.role.template) return;
  const dept = company.departments.find((d) => d.key === a.role.department)!;
  // A run on the role's other engine (S4-5) gets the folder for that engine, rendered the same way as if the role file named it.
  await renderWorkdir(over ? { ...a, role: { ...a.role, runtime: over.runtime, model: over.model } } : a, {
    dataDir: sys.dataDir,
    workspaceSlug: sys.workspace.slug,
    companyName: await companyName(sys.companyRoot),
    companyMd: company.companyMd,
    departmentName: dept.name,
    osUrl: sys.osUrl,
    templatesRoot: sys.templatesRoot,
  });
}
