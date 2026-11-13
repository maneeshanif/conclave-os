import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { tool } from '@openai/agents';
import { z } from 'zod';

/**
 * The skill loader for runtimes that have no skills folder of their own (SPEC 5, the table). Claude Code and OpenCode read
 * `.claude/skills`; the in-process runner is told each skill's name and one-line description in its instructions and gets one
 * tool, `load_skill`, that returns a skill's text. The only skills it can reach are the ones the renderer copied into this
 * agent's `.skills` folder, and nothing outside that folder, however the name is written.
 */
export interface SkillInfo {
  name: string;
  description: string;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

function frontMatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

/** The real path of a granted skill's SKILL.md, or null: not a name, not there, or a link that leads out of the folder. */
async function resolveSkillFile(dir: string, name: string): Promise<string | null> {
  if (!NAME.test(name)) return null;
  const root = await realpath(dir).catch(() => null);
  if (!root) return null;
  const real = await realpath(path.join(root, name, 'SKILL.md')).catch(() => null);
  if (!real) return null;
  const rel = path.relative(root, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return (await stat(real)).isFile() ? real : null;
}

/** The skills in an agent's `.skills` folder, with the description each one gives itself. A folder with no SKILL.md is not a skill. */
export async function listSkills(dir: string): Promise<SkillInfo[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: SkillInfo[] = [];
  for (const name of names.sort()) {
    const file = await resolveSkillFile(dir, name);
    if (!file) continue;
    out.push({ name, description: frontMatter(await readFile(file, 'utf8')).description || 'No description given.' });
  }
  return out;
}

/** The lines added to the instructions: names and descriptions only, never the skill text. */
export function skillInstructions(skills: SkillInfo[]): string {
  if (!skills.length) return '';
  return ['# Skills', 'You have these skills. Before you do the kind of work one describes, call load_skill with its name and follow it.', ...skills.map((s) => `- ${s.name}: ${s.description}`)].join('\n');
}

/** Returns a granted skill's text, or throws a plain sentence saying why not. Used by the tool and by the tests. */
export async function loadSkill(dir: string, name: string): Promise<string> {
  if (!NAME.test(name)) throw new Error(`"${name}" is not a skill name. Skill names are lower-case words joined by hyphens.`);
  const file = await resolveSkillFile(dir, name);
  if (!file) throw new Error(`You do not have a skill called "${name}".`);
  return readFile(file, 'utf8');
}

/** The one tool the in-process runner adds to the `os` tools. */
export function loadSkillTool(dir: string) {
  return tool({
    name: 'load_skill',
    description: 'Returns the full text of one of your skills, by name. Use it before doing the kind of work the skill describes.',
    parameters: z.object({ name: z.string().max(64) }),
    execute: async ({ name }) => loadSkill(dir, name),
    // A refused skill is an answer the model can read and act on, not a crash of the run.
    errorFunction: (_ctx, error) => (error instanceof Error ? error.message : String(error)),
  });
}
