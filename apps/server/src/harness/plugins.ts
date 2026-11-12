import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { osTools } from './os-tools';

/**
 * Plugins (SPEC 8): a folder in `plugins/` that bundles skills and says which connectors and `os` tools they need.
 * A role file that names a plugin gets its skills and connectors written into its working folder by the renderer.
 * Skills stay in the open Agent Skills format, so Claude Code and OpenCode both load them (SPEC 5, portability).
 *
 * Only the `os` connector exists in this slice. A manifest that asks for any other is refused here, so a plugin
 * can never promise a connector that nothing will wire.
 */
const KNOWN_CONNECTORS = ['os'] as const;

const Name = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits and dashes');

export const PluginManifestSchema = z
  .object({
    name: Name,
    version: z.number().int().positive(),
    description: z.string().min(1),
    skills: z.array(Name).default([]),
    connectors: z.array(Name).default(['os']),
    /** The `os` tools the plugin's skills use. Documentation that is checked, so it cannot drift from the server. */
    tools: z.array(z.string()).default([]),
  })
  .strict();

export interface LoadedPlugin {
  name: string;
  version: number;
  description: string;
  dir: string;
  skills: string[];
  connectors: string[];
  tools: string[];
}

export async function loadPlugin(pluginsRoot: string, name: string): Promise<LoadedPlugin> {
  // A plugin name is a folder name and nothing else: no separators, no dots, no way out of plugins/.
  if (!Name.safeParse(name).success) {
    throw new Error(`Bad plugin name "${name}": a plugin name is a folder name, lowercase letters, digits and dashes only.`);
  }
  const dir = path.join(pluginsRoot, name);
  let raw: string;
  try {
    raw = await readFile(path.join(dir, 'plugin.yaml'), 'utf8');
  } catch {
    throw new Error(`Unknown plugin "${name}": there is no ${path.join(dir, 'plugin.yaml')}`);
  }
  const parsed = PluginManifestSchema.safeParse(parseYaml(raw));
  if (!parsed.success) throw new Error(`Plugin "${name}": ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  const m = parsed.data;

  if (m.name !== name) throw new Error(`Plugin "${name}": name "${m.name}" does not match its folder "${name}"`);
  for (const skill of m.skills) {
    const file = path.join(dir, 'skills', skill, 'SKILL.md');
    if (!(await stat(file).then((s) => s.isFile(), () => false))) {
      throw new Error(`Plugin "${name}": skill "${skill}" has no SKILL.md (expected ${path.join('skills', skill, 'SKILL.md')})`);
    }
  }
  for (const tool of m.tools) {
    if (!(tool in osTools)) throw new Error(`Plugin "${name}": tool "${tool}" is not an os tool. Known: ${Object.keys(osTools).join(', ')}`);
  }
  for (const c of m.connectors) {
    if (!(KNOWN_CONNECTORS as readonly string[]).includes(c)) {
      throw new Error(`Plugin "${name}": connector "${c}" is not available yet. Known: ${KNOWN_CONNECTORS.join(', ')}`);
    }
  }
  return { ...m, dir };
}
