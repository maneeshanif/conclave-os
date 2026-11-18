import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { keywords } from '../memory/memory';
import { diffLines } from '../memory/skills';

/**
 * The talent catalog (S8-4, SPEC 9): ready-written personas from other people's repositories. They are text from strangers, so they are imported
 * from a local folder at a pinned id (never fetched at run time), scanned for instructions, kept with their licence, shown as a diff when they
 * change, and stripped of any tool they name. A persona is a prompt only; tools come from the template that frames it.
 */

const SUSPECT: [RegExp, string][] = [
  [/\b(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|your)\s+(instructions|rules|prompt)/i, 'tells the reader to ignore its instructions'],
  [/\b(call|invoke|use|run)\s+(the\s+)?`?[a-z][a-z0-9_]*`?\s+tool\b/i, 'tells the reader to call a tool'],
  [/\b(curl|wget)\b|\|\s*(sh|bash)\b|\brm\s+-rf\b|\bsudo\b/i, 'contains a shell command'],
  [/\b(fetch|download|open|visit|browse|load)\s+(the\s+)?(page\s+|url\s+|link\s+|file\s+)?(at\s+)?https?:\/\//i, 'tells the reader to fetch a page'],
  [/\b(reveal|print|show|send)\s+(me\s+)?(your\s+)?(system\s+prompt|api\s+key|password|secret|token)/i, 'asks for a secret or the system prompt'],
];

/** The reasons a persona looks like it is trying to instruct whoever reads it. Empty for a plain persona. */
export function scanPersona(text: string): string[] {
  return SUSPECT.filter(([re]) => re.test(text)).map(([, why]) => why);
}

interface Persona {
  name: string;
  description: string | null;
  body: string;
  dropped: string[];
}

/** Takes the name and description from the frontmatter, if any; every other key (tools above all) is dropped and only its name is kept. */
function parsePersona(text: string, fallbackName: string): Persona {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  let name: string | null = null;
  let description: string | null = null;
  const dropped: string[] = [];
  let body = text;
  if (m) {
    body = m[2]!;
    for (const line of m[1]!.split(/\r?\n/)) {
      const k = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
      if (!k) continue;
      const v = k[2]!.trim().replace(/^"|"$/g, '');
      if (k[1] === 'name') name = v;
      else if (k[1] === 'description') description = v;
      else dropped.push(k[1]!);
    }
  }
  body = body.replace(/^\s+/, '');
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return { name: (name ?? heading ?? fallbackName).slice(0, 200), description: description?.slice(0, 500) ?? null, body: body.trim(), dropped };
}

async function* walk(dir: string, rel = ''): AsyncGenerator<string> {
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walk(dir, r);
    else if (/\.md$/i.test(e.name) && !/^(readme|license|licence|contributing|changelog)\.md$/i.test(e.name)) yield r;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export interface ImportReport {
  added: number;
  changed: number;
  unchanged: number;
  flagged: number;
  diffs: { key: string; diff: string }[];
}

/**
 * Imports a local folder as one source. It must have a LICENSE file (kept with every role) and a pinned id (the commit it was taken at). A role
 * already stored whose text changed is reported as a diff and left alone unless `accept` is set.
 */
export async function importCatalog(pool: pg.Pool, workspaceId: string, dir: string, o: { source: string; pinnedId: string; accept?: boolean }): Promise<ImportReport> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(o.source)) throw new Error('A catalog source is a lower-case name.');
  if (!o.pinnedId.trim()) throw new Error('A catalog is imported at a pinned id (a commit), never from whatever is latest.');
  let license: string;
  try {
    license = (await readFile(path.join(dir, 'LICENSE'), 'utf8')).trim();
  } catch {
    throw new Error('This source has no LICENSE file. Every source keeps its licence, so nothing was imported.');
  }
  if (!license) throw new Error('The LICENSE file is empty, so nothing was imported.');

  const report: ImportReport = { added: 0, changed: 0, unchanged: 0, flagged: 0, diffs: [] };
  const files: string[] = [];
  for await (const f of walk(dir)) files.push(f);
  files.sort();
  for (const rel of files) {
    const parts = rel.split('/');
    const division = parts.length > 1 ? slug(parts[0]!) : 'general';
    const key = slug(parts[parts.length - 1]!.replace(/\.md$/i, ''));
    if (!key) continue;
    const persona = parsePersona(await readFile(path.join(dir, rel), 'utf8'), key);
    if (!persona.body) continue;
    const flags = scanPersona(persona.body);
    const hash = createHash('sha256').update(persona.body).digest('hex');
    await withWorkspace(pool, workspaceId, async ({ client: c }) => {
      const cur = (await c.query<{ id: string; hash: string; text: string }>('select id, hash, text from catalog_roles where source = $1 and key = $2', [o.source, key])).rows[0];
      if (!cur) {
        await c.query(
          'insert into catalog_roles (workspace_id, source, key, division, name, description, text, hash, pinned_id, license, flagged, flags, dropped_keys) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          [workspaceId, o.source, key, division, persona.name, persona.description, persona.body, hash, o.pinnedId, license, flags.length > 0, JSON.stringify(flags), JSON.stringify(persona.dropped)],
        );
        report.added++;
        if (flags.length) report.flagged++;
      } else if (cur.hash === hash) {
        report.unchanged++;
      } else {
        report.changed++;
        report.diffs.push({ key, diff: diffLines(cur.text, persona.body) });
        if (o.accept) {
          await c.query('update catalog_roles set division = $2, name = $3, description = $4, text = $5, hash = $6, pinned_id = $7, license = $8, flagged = $9, flags = $10, dropped_keys = $11, imported_at = now() where id = $1', [cur.id, division, persona.name, persona.description, persona.body, hash, o.pinnedId, license, flags.length > 0, JSON.stringify(flags), JSON.stringify(persona.dropped)]);
        }
      }
    });
  }
  return report;
}

export interface CatalogHit {
  id: string;
  source: string;
  key: string;
  division: string;
  name: string;
  description: string | null;
}

/** Finds roles by words, best first; a flagged role is never found. Meaning search comes with pgvector (parked). */
export async function searchCatalog(pool: pg.Pool, workspaceId: string, query: string, o: { division?: string; limit?: number } = {}): Promise<CatalogHit[]> {
  const words = keywords(query);
  if (!words.length) return [];
  const q = words.join(' | ');
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) =>
    c.query<CatalogHit>(
      `select id, source, key, division, name, description from catalog_roles
        where not flagged and to_tsvector('simple', name || ' ' || coalesce(description, '') || ' ' || text) @@ to_tsquery('simple', $1)
          and ($2::text is null or division = $2)
        order by ts_rank(to_tsvector('simple', name || ' ' || coalesce(description, '') || ' ' || text), to_tsquery('simple', $1)) desc, name
        limit $3`,
      [q, o.division ?? null, Math.min(20, o.limit ?? 5)],
    ),
  );
  return r.rows;
}
