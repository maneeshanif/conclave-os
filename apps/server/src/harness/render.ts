import { mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { modelNameFor } from '../config/models';
import { parseRoleFile, type LoadedAgent } from '../company/loader';
import { RoleFileSchema, type RoleFile } from '../company/schema';
import { RUNTIMES, type RuntimeName } from '../runtimes/names';
import { agentWorkDir } from '../paths';
import { fill } from './fill';
import { PermissionsSchema, SHELL_TEMPLATES, claudeToolLists, opencodePermission, type Permissions } from './permissions';

/** Placeholder the runner replaces with a per-run token just before each run (S0-6). */
export const RUN_TOKEN_PLACEHOLDER = 'RUN_TOKEN_NOT_SET';

const TemplateFileSchema = z.object({
  key: z.string(),
  version: z.number().int().positive(),
  description: z.string(),
  params: z.array(z.object({ name: z.string(), required: z.boolean() })),
  defaults: z.object({
    runtime: z.enum(RUNTIMES),
    model: z.string(),
    autonomy: z.number().int().min(0).max(3).default(0),
    monthly_budget_usd: z.number().nonnegative(),
    max_turns: z.number().int().positive(),
    heartbeat: z.string().optional(),
  }),
  skills: z.array(z.string()).default([]),
});

const ConnectorsFileSchema = z.object({ connectors: z.array(z.string()).default(['os']) });

export interface Template {
  key: string;
  version: number;
  dir: string;
  file: z.infer<typeof TemplateFileSchema>;
  agentBody: string;
  rules: string;
  permissions: Permissions;
  connectors: string[];
}

export async function loadTemplate(templatesRoot: string, key: string): Promise<Template> {
  const dir = path.join(templatesRoot, 'agents', key);
  const read = (f: string) => readFile(path.join(dir, f), 'utf8');
  let raw: string;
  try {
    raw = await read('template.yaml');
  } catch {
    throw new Error(`Unknown template "${key}": no ${path.join(dir, 'template.yaml')}`);
  }
  const file = TemplateFileSchema.parse(parseYaml(raw));
  const permissions = PermissionsSchema.parse(parseYaml(await read('permissions.yaml')) ?? {});
  if (permissions.shell === 'allow' && !SHELL_TEMPLATES.has(key)) {
    throw new Error(`Template "${key}" allows a shell. Only ${[...SHELL_TEMPLATES].join(' and ')} may (CLAUDE.md rule 10).`);
  }
  const { connectors } = ConnectorsFileSchema.parse(parseYaml(await read('connectors.yaml')) ?? {});
  if (!connectors.includes('os')) connectors.unshift('os');
  return {
    key,
    version: file.version,
    dir,
    file,
    agentBody: await read('AGENT.md.hbs'),
    rules: await read('RULES.md.hbs'),
    permissions,
    connectors,
  };
}

export interface RoleParams {
  id: string;
  name: string;
  department: string;
  department_name: string;
  company_name: string;
  reports_to?: string;
  runtime?: RuntimeName;
  model?: string;
}

/** Renders a template into a role file: front matter plus body (SPEC 5). Returns the file text. */
export function renderRoleFile(t: Template, params: RoleParams): string {
  const values: Record<string, string | undefined> = { ...params };
  for (const p of t.file.params) {
    if (p.required && (values[p.name] === undefined || values[p.name] === '')) {
      throw new Error(`Template "${t.key}" needs parameter "${p.name}"`);
    }
  }
  const role: RoleFile = RoleFileSchema.parse({
    id: params.id,
    name: params.name,
    department: params.department,
    ...(params.reports_to ? { reports_to: params.reports_to } : {}),
    runtime: params.runtime ?? t.file.defaults.runtime,
    model: params.model ?? t.file.defaults.model,
    ...(t.file.defaults.heartbeat ? { heartbeat: t.file.defaults.heartbeat } : {}),
    monthly_budget_usd: t.file.defaults.monthly_budget_usd,
    autonomy: t.file.defaults.autonomy,
    template: t.key,
    template_version: t.version,
    skills: t.file.skills,
    connectors: t.connectors,
    max_turns: t.file.defaults.max_turns,
  });
  const body = fill(t.agentBody, values, `${t.key}/AGENT.md.hbs`);
  const text = `---\n${stringifyYaml(role).trim()}\n---\n\n${body.trim()}\n`;
  parseRoleFile(text, `${params.id}/AGENT.md`); // validates alias against runtime
  return text;
}

export interface WorkdirContext {
  dataDir: string;
  workspaceSlug: string;
  companyName: string;
  companyMd: string;
  departmentName: string;
  /** URL of the `os` MCP endpoint, on 127.0.0.1. */
  osUrl: string;
  templatesRoot: string;
}

/** Every path a render target may write, relative to the working folder. Cleared before each render. */
const GENERATED = ['CLAUDE.md', 'AGENTS.md', 'opencode.json', '.claude', '.opencode', '.mcp.json', 'ROLE.md'];

async function writeFiles(dir: string, files: Record<string, string>): Promise<string[]> {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return Object.keys(files).sort();
}

async function skillFiles(t: Template, base: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const root = path.join(t.dir, 'skills');
  const names = await readdir(root).catch(() => [] as string[]);
  for (const name of names) {
    const file = path.join(root, name, 'SKILL.md');
    try {
      await stat(file);
    } catch {
      continue;
    }
    out[`${base}/${name}/SKILL.md`] = await readFile(file, 'utf8');
  }
  return out;
}

function osServer(url: string) {
  return { url, headers: { Authorization: `Bearer ${RUN_TOKEN_PLACEHOLDER}` } };
}

/** Files for the Claude Code target. */
async function claudeTarget(agent: LoadedAgent, t: Template, rules: string, ctx: WorkdirContext) {
  const tools = claudeToolLists(t.permissions);
  return {
    'CLAUDE.md': rules,
    'ROLE.md': agent.body + '\n',
    '.claude/settings.json': JSON.stringify({ permissions: { allow: tools.allow, deny: tools.deny } }, null, 2) + '\n',
    '.mcp.json': JSON.stringify({ mcpServers: { os: { type: 'http', ...osServer(ctx.osUrl) } } }, null, 2) + '\n',
    ...(await skillFiles(t, '.claude/skills')),
  };
}

/** Files for the OpenCode target (opencode 1.19 config shape, checked with `opencode debug config`). */
async function opencodeTarget(agent: LoadedAgent, t: Template, rules: string, ctx: WorkdirContext) {
  const modelName = modelNameFor(agent.role.model, 'opencode');
  const permission = opencodePermission(t.permissions);
  const agentFm: Record<string, unknown> = {
    description: `${agent.role.name}, ${ctx.departmentName}`,
    mode: 'primary',
    ...(modelName ? { model: modelName } : {}),
    permission,
  };
  const config = {
    $schema: 'https://opencode.ai/config.json',
    default_agent: agent.role.id,
    share: 'disabled',
    autoupdate: false,
    mcp: { os: { type: 'remote', ...osServer(ctx.osUrl), enabled: true } },
    permission,
  };
  return {
    'AGENTS.md': rules,
    [`.opencode/agents/${agent.role.id}.md`]: `---\n${stringifyYaml(agentFm).trim()}\n---\n\n${agent.body}\n`,
    'opencode.json': JSON.stringify(config, null, 2) + '\n',
    ...(await skillFiles(t, '.opencode/skills')),
  };
}

export interface RenderedWorkdir {
  dir: string;
  runtime: RuntimeName;
  files: string[];
}

/** Renders an agent's working folder for the runtime its role file names (SPEC 5, how grants reach a CLI). */
export async function renderWorkdir(agent: LoadedAgent, ctx: WorkdirContext): Promise<RenderedWorkdir> {
  if (!agent.role.template) throw new Error(`${agent.rolePath}: no template named, cannot render a working folder`);
  const t = await loadTemplate(ctx.templatesRoot, agent.role.template);
  const dir = agentWorkDir(ctx.dataDir, ctx.workspaceSlug, agent.role.id);
  const rules = fill(
    t.rules,
    {
      name: agent.role.name,
      company_name: ctx.companyName,
      department_name: ctx.departmentName,
      company_md: ctx.companyMd.trim(),
    },
    `${t.key}/RULES.md.hbs`,
  );
  let files: Record<string, string>;
  switch (agent.role.runtime) {
    case 'claude-cli':
      files = await claudeTarget(agent, t, rules, ctx);
      break;
    case 'opencode':
      files = await opencodeTarget(agent, t, rules, ctx);
      break;
    default:
      throw new Error(`Runtime "${agent.role.runtime}" is not built in this slice, so it has no render target yet.`);
  }
  await mkdir(dir, { recursive: true });
  for (const g of GENERATED) await rm(path.join(dir, g), { recursive: true, force: true });
  await mkdir(path.join(dir, 'work'), { recursive: true });
  return { dir, runtime: agent.role.runtime, files: await writeFiles(dir, files) };
}
