import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { diffLines } from '../memory/skills';
import { scanPersona } from '../talent/catalog';
import { loadPlugin } from './plugins';

/**
 * The plugin marketplace (S9-6, SPEC 8, 16): a folder, or a git repository checked out to a folder, with one directory per plugin. Installing
 * copies one into `plugins/` after checks, because a plugin is text from someone else that agents will read and, through its skills, may act on:
 * it needs a licence file; its manifest must load (every tool it names is a real os tool); no file may tell the reader to ignore its rules,
 * call a tool, run a command or fetch a page; and no skill may carry a tool grant in its own frontmatter (`allowed-tools`, `tools`), because
 * a harness would honour it. A plugin that is already installed and has changed is shown as a diff and is not replaced unless accepted.
 */
export interface InstallReport {
  name: string;
  status: 'installed' | 'unchanged' | 'changed' | 'refused';
  reasons: string[];
  diffs: { file: string; diff: string }[];
  /** Connectors the manifest asks for beyond `os`: a person grants them, installing grants none. */
  connectorsAsked: string[];
}

const GRANT_KEYS = /^(allowed-tools|allowed_tools|tools|permissions|mcp-servers|hooks)\s*:/im;

async function* files(dir: string, rel = ''): AsyncGenerator<string> {
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* files(dir, r);
    else if (e.isFile()) yield r;
  }
}

const exists = (p: string) => stat(p).then(() => true, () => false);

export async function installPlugin(marketRoot: string, name: string, pluginsRoot: string, o: { accept?: boolean } = {}): Promise<InstallReport> {
  const report: InstallReport = { name, status: 'refused', reasons: [], diffs: [], connectorsAsked: [] };
  const refuse = (...why: string[]): InstallReport => ({ ...report, reasons: why });
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return refuse('A plugin name is a folder name: lower-case letters, digits and dashes.');
  const src = path.join(marketRoot, name);
  if (!(await exists(path.join(src, 'plugin.yaml')))) return refuse(`The marketplace has no plugin called "${name}".`);
  if (!(await exists(path.join(src, 'LICENSE'))) && !(await exists(path.join(src, 'LICENSE.md')))) return refuse('The plugin has no LICENSE file, so it was not installed. Every source keeps its licence.');
  let plugin;
  try {
    plugin = await loadPlugin(marketRoot, name);
  } catch (err) {
    return refuse((err as Error).message);
  }
  report.connectorsAsked = plugin.connectors.filter((c) => c !== 'os');

  const problems: string[] = [];
  const incoming = new Map<string, string>();
  for await (const rel of files(src)) {
    if (!/\.(md|ya?ml|json|txt|hbs)$/i.test(rel)) continue;
    const text = await readFile(path.join(src, rel), 'utf8');
    incoming.set(rel, text);
    for (const why of scanPersona(text)) problems.push(`${rel}: ${why}`);
    if (/(^|\/)SKILL\.md$/.test(rel)) {
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
      if (GRANT_KEYS.test(fm)) problems.push(`${rel}: the skill carries a tool grant in its own frontmatter, which a harness would honour`);
    }
  }
  if (problems.length) return refuse(...problems);

  const dest = path.join(pluginsRoot, name);
  if (await exists(dest)) {
    for (const [rel, text] of incoming) {
      const cur = await readFile(path.join(dest, rel), 'utf8').catch(() => null);
      if (cur !== text) report.diffs.push({ file: rel, diff: cur === null ? `+${text.split(/\r?\n/).filter(Boolean).join('\n+')}` : diffLines(cur, text) });
    }
    if (!report.diffs.length) return { ...report, status: 'unchanged' };
    if (!o.accept) return { ...report, status: 'changed' };
  }
  await mkdir(pluginsRoot, { recursive: true });
  await cp(src, dest, { recursive: true, filter: (s) => !path.basename(s).startsWith('.') });
  return { ...report, status: 'installed' };
}
