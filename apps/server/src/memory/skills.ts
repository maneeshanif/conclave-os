import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadTemplate } from '../harness/render';

/** Skill files in the open format: a frontmatter with name and description, then the body. Self-written changes add a version (S8-3). */
interface Parsed {
  name: string | null;
  descriptionLine: string | null;
  version: number;
  body: string;
}

function parse(text: string): Parsed | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const lines = m[1]!.split(/\r?\n/);
  const get = (k: string) => lines.find((l) => l.startsWith(`${k}:`));
  const v = get('version');
  return { name: get('name')?.slice(5).trim().replace(/^"|"$/g, '') ?? null, descriptionLine: get('description') ?? null, version: v ? Number.parseInt(v.slice(8), 10) || 1 : 1, body: m[2]!.replace(/^\s+/, '') };
}

export const skillVersion = (text: string): number => parse(text)?.version ?? 1;

/** Checks a proposed whole-file text against the skill it replaces. Returns the reason it is refused, or null. */
export function checkNewSkill(skill: string, current: string, next: string): string | null {
  if (next.length > 20_000) return 'The skill text is too long (20000 characters at most).';
  const p = parse(next);
  if (!p || !p.name) return 'The skill text must start with a frontmatter that has a name and a description.';
  if (p.name !== skill) return `The skill's name must stay "${skill}".`;
  if (!p.descriptionLine) return 'The skill text needs a description: it decides whether the skill is used.';
  if (!p.body.trim()) return 'The skill has no body.';
  if (!parse(current)) return 'The current skill file has no frontmatter, so it cannot be patched safely.';
  return null;
}

/** The file after a patch: the new name, description and body, with the version one higher than the file it replaces. */
export function applySkillPatch(current: string, next: string): string {
  const old = parse(current);
  const p = parse(next)!;
  return `---\nname: ${p.name}\n${p.descriptionLine}\nversion: ${(old?.version ?? 1) + 1}\n---\n\n${p.body.trimEnd()}\n`;
}

/** What changed, as lines: `-` for a line that is gone, `+` for one that is new. A card shows it; the whole old text is kept beside it. */
export function diffLines(a: string, b: string): string {
  const A = a.split(/\r?\n/);
  const B = b.split(/\r?\n/);
  const inA = new Set(A);
  const inB = new Set(B);
  return [...A.filter((l) => !inB.has(l) && l.trim()).map((l) => `-${l}`), ...B.filter((l) => !inA.has(l) && l.trim()).map((l) => `+${l}`)].join('\n');
}

export interface SkillHome {
  file: string;
  owner: { kind: 'template' | 'plugin'; name: string };
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Where a skill lives for an agent made from a template: the template's own skills, then its plugins'. Null if it is not one of its skills. */
export async function locateSkill(templatesRoot: string, templateKey: string, skill: string): Promise<SkillHome | null> {
  if (!NAME.test(skill)) return null;
  const t = await loadTemplate(templatesRoot, templateKey);
  const homes: { dir: string; owner: SkillHome['owner'] }[] = [{ dir: t.dir, owner: { kind: 'template', name: t.key } }, ...t.plugins.map((p) => ({ dir: p.dir, owner: { kind: 'plugin' as const, name: p.name } }))];
  for (const h of homes) {
    const file = path.join(h.dir, 'skills', skill, 'SKILL.md');
    if (await stat(file).then((s) => s.isFile(), () => false)) return { file, owner: h.owner };
  }
  return null;
}

/** The file for a recorded owner, found again at execution so a payload never names a path. */
export async function skillFileFor(templatesRoot: string, owner: SkillHome['owner'], skill: string): Promise<string | null> {
  if (!NAME.test(skill) || !NAME.test(owner.name)) return null;
  const dir = owner.kind === 'template' ? path.join(templatesRoot, 'agents', owner.name) : path.join(templatesRoot, '..', 'plugins', owner.name);
  const file = path.join(dir, 'skills', skill, 'SKILL.md');
  return (await stat(file).then((s) => s.isFile(), () => false)) ? file : null;
}

export const readSkill = (file: string) => readFile(file, 'utf8');
