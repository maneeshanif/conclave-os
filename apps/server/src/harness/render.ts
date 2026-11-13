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
import { clampForTrust } from './trust';
import { PermissionsSchema, SHELL_TEMPLATES, assertRunnerCanEnforce, claudeToolLists, opencodePermission, type Permissions } from './permissions';
import { loadPlugin, type LoadedPlugin } from './plugins';

/**
 * The run token reaches the `os` server through an environment variable that the runner sets
 * for each run, so no token is ever written to disk. Each harness has its own expansion syntax.
 */
const TOKEN_REF = { claude: '${CONCLAVE_RUN_TOKEN}', opencode: '{env:CONCLAVE_RUN_TOKEN}' } as const;

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
    heartbeat_task: z.string().min(1).max(2000).optional(),
    output_check: z.string().min(1).optional(),
    fallback_runtime: z.enum(RUNTIMES).optional(),
    fallback_model: z.string().min(1).optional(),
    start_paused: z.boolean().optional(),
    trust: z.enum(['standard', 'low']).optional(),
  }),
  skills: z.array(z.string()).default([]),
  /** Plugins from plugins/ this kind of agent is granted: their skills and connectors come with it (SPEC 8). */
  plugins: z.array(z.string()).default([]),
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
  /** The template's own connectors plus whatever its plugins need. `os` is always first. */
  connectors: string[];
  plugins: LoadedPlugin[];
}

/** plugins/ sits beside templates/ in the repo (SPEC 13). */
export const defaultPluginsRoot = (templatesRoot: string) => path.join(templatesRoot, '..', 'plugins');

export async function loadTemplate(templatesRoot: string, key: string, pluginsRoot = defaultPluginsRoot(templatesRoot)): Promise<Template> {
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
  const plugins: LoadedPlugin[] = [];
  for (const name of file.plugins) plugins.push(await loadPlugin(pluginsRoot, name));
  // A skill name belongs to one source. Two sources with the same name would silently overwrite each other.
  const seen = new Map<string, string>();
  for (const [skill, source] of [...file.skills.map((n) => [n, `template "${key}"`] as const), ...plugins.flatMap((p) => p.skills.map((n) => [n, `plugin "${p.name}"`] as const))]) {
    const first = seen.get(skill);
    if (first) throw new Error(`Template "${key}": skill "${skill}" comes from both ${first} and ${source}`);
    seen.set(skill, source);
  }
  for (const c of plugins.flatMap((p) => p.connectors)) if (!connectors.includes(c)) connectors.push(c);
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
    plugins,
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
  /** Overrides the template's starting level. New hires start at the template's level (0), and are promoted later. */
  autonomy?: number;
}

/** Renders a template into a role file: front matter plus body (SPEC 5). Returns the file text. */
export function renderRoleFile(t: Template, params: RoleParams): string {
  // Placeholders in the role text take text; the starting level is not one of them.
  const values: Record<string, string | undefined> = Object.fromEntries(Object.entries(params).filter(([, v]) => v === undefined || typeof v === 'string'));
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
    ...(t.file.defaults.heartbeat_task ? { heartbeat_task: t.file.defaults.heartbeat_task } : {}),
    ...(t.file.defaults.output_check ? { output_check: t.file.defaults.output_check } : {}),
    ...(t.file.defaults.fallback_runtime ? { fallback_runtime: t.file.defaults.fallback_runtime } : {}),
    ...(t.file.defaults.fallback_model ? { fallback_model: t.file.defaults.fallback_model } : {}),
    ...(t.file.defaults.start_paused ? { start_paused: true } : {}),
    ...(t.file.defaults.trust === 'low' ? { trust: 'low' as const } : {}),
    monthly_budget_usd: t.file.defaults.monthly_budget_usd,
    autonomy: params.autonomy ?? t.file.defaults.autonomy,
    template: t.key,
    template_version: t.version,
    plugins: t.plugins.map((p) => p.name),
    skills: [...t.file.skills, ...t.plugins.flatMap((p) => p.skills)],
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
const GENERATED = ['CLAUDE.md', 'AGENTS.md', 'opencode.json', '.claude', '.opencode', '.mcp.json', 'ROLE.md', '.xdg-config', 'INSTRUCTIONS.md', '.skills', '.runner.json'];

async function writeFiles(dir: string, files: Record<string, string>): Promise<string[]> {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return Object.keys(files).sort();
}

/** The skills an agent gets: the template's own, then each plugin's. Both targets read the same open skill format. */
async function skillFiles(t: Template, base: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const dir of [t.dir, ...t.plugins.map((p) => p.dir)]) {
    const root = path.join(dir, 'skills');
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
  }
  return out;
}

function osServer(url: string, harness: keyof typeof TOKEN_REF) {
  return { url, headers: { Authorization: `Bearer ${TOKEN_REF[harness]}` } };
}

/**
 * Every harness config lives in the agent folder, and the agent runs one level down, in `work/`, so
 * its file tools (scoped to the working directory) can never rewrite its own config, permissions or
 * connectors. Harness files planted in `work/` are removed before every run (see `cleanWorkFolder`).
 */
export const WORK_SUBDIR = 'work';

/** Files for the Claude Code target. Claude Code loads CLAUDE.md from the parent of `work/` too. */
async function claudeTarget(agent: LoadedAgent, t: Template, rules: string, ctx: WorkdirContext) {
  const tools = claudeToolLists(clampForTrust(t.permissions, agent.role.trust));
  return {
    'CLAUDE.md': `${rules.trim()}\n\n# Your role\n\n${agent.body.trim()}\n`,
    '.claude/settings.json': JSON.stringify({ permissions: { allow: tools.allow, deny: tools.deny } }, null, 2) + '\n',
    '.mcp.json': JSON.stringify({ mcpServers: { os: { type: 'http', ...osServer(ctx.osUrl, 'claude') } } }, null, 2) + '\n',
    ...(await skillFiles(t, '.claude/skills')),
  };
}

/**
 * Files for the OpenCode target (opencode 1.19 config shape, checked with `opencode debug config`).
 * The runner points OPENCODE_CONFIG at this file and turns project config off, so a config the agent
 * writes into `work/` is ignored. The agent, its instructions and its skills are all named here by
 * absolute path.
 */
async function opencodeTarget(agent: LoadedAgent, t: Template, rules: string, ctx: WorkdirContext, dir: string) {
  const modelName = modelNameFor(agent.role.model, 'opencode');
  const permission = opencodePermission(clampForTrust(t.permissions, agent.role.trust));
  const config = {
    $schema: 'https://opencode.ai/config.json',
    default_agent: agent.role.id,
    share: 'disabled',
    autoupdate: false,
    instructions: [path.join(dir, 'AGENTS.md')],
    skills: { paths: [path.join(dir, '.opencode', 'skills')] },
    agent: {
      [agent.role.id]: {
        description: `${agent.role.name}, ${ctx.departmentName}`,
        mode: 'primary',
        ...(modelName ? { model: modelName } : {}),
        permission,
        prompt: agent.body,
      },
    },
    mcp: { os: { type: 'remote', ...osServer(ctx.osUrl, 'opencode'), enabled: true } },
    permission,
  };
  return {
    'AGENTS.md': rules,
    'opencode.json': JSON.stringify(config, null, 2) + '\n',
    ...(await skillFiles(t, '.opencode/skills')),
  };
}

/**
 * Files for the in-process runner (`openai-agents`). It has no config files of its own: the standing rules and the role become
 * one `INSTRUCTIONS.md`, the granted skills are copied to `.skills`, and `.runner.json` records what the runner is given
 * (the `os` tools and `load_skill`) and which grants it cannot provide. The runtime reads these at the start of each run.
 */
async function openaiAgentsTarget(agent: LoadedAgent, t: Template, rules: string) {
  const notProvided = assertRunnerCanEnforce(clampForTrust(t.permissions, agent.role.trust));
  return {
    'INSTRUCTIONS.md': `${rules.trim()}\n\n# Your role\n\n${agent.body.trim()}\n`,
    '.runner.json': JSON.stringify({ runtime: 'openai-agents', tools: ['os', 'load_skill'], notProvided }, null, 2) + '\n',
    ...(await skillFiles(t, '.skills')),
  };
}

/** Harness files that must never exist inside `work/`, where the agent can write. */
const PLANTABLE = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'opencode.json', 'opencode.jsonc', '.claude', '.opencode', '.mcp.json', 'INSTRUCTIONS.md', '.skills', '.runner.json'];

/** Removes any harness config an agent wrote into its `work/` folder. Run before every run. */
export async function cleanWorkFolder(agentDir: string): Promise<void> {
  const work = path.join(agentDir, WORK_SUBDIR);
  await mkdir(work, { recursive: true });
  for (const f of PLANTABLE) await rm(path.join(work, f), { recursive: true, force: true });
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
      files = await opencodeTarget(agent, t, rules, ctx, dir);
      break;
    case 'openai-agents':
      files = await openaiAgentsTarget(agent, t, rules);
      break;
    default:
      throw new Error(`Runtime "${agent.role.runtime}" is not built in this slice, so it has no render target yet.`);
  }
  await mkdir(dir, { recursive: true });
  for (const g of GENERATED) await rm(path.join(dir, g), { recursive: true, force: true });
  await cleanWorkFolder(dir);
  // An empty config home for OpenCode, so the owner's global OpenCode config never reaches an agent.
  await mkdir(path.join(dir, '.xdg-config'), { recursive: true });
  return { dir, runtime: agent.role.runtime, files: await writeFiles(dir, files) };
}
